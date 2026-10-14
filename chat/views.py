# chat/views.py  (replaces the previous file)
import os
import re

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import transaction
from django.db.models import F, Max, Q
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.http import content_disposition_header
from rest_framework import generics, permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import Department

from .models import Conversation, Membership, Message
from .serializers import (
    ConversationDetailSerializer,
    ConversationSerializer,
    DepartmentSerializer,
    MessageSerializer,
    UserSerializer,
    message_payload,
)

User = get_user_model()


def serialize_conversation(conversation, request, detail=False):
    conversation = Conversation.objects.prefetch_related("memberships__user").get(
        pk=conversation.pk
    )
    cls = ConversationDetailSerializer if detail else ConversationSerializer
    return cls(conversation, context={"request": request}).data


def parse_ids(value):
    if not isinstance(value, list):
        return None
    try:
        return [int(v) for v in value]
    except (TypeError, ValueError):
        return None


def require_group_admin(user, conversation):
    if not Membership.objects.filter(
        conversation=conversation, user=user, role=Membership.ADMIN
    ).exists():
        raise PermissionDenied("Only group admins can do this.")


# ---------- authentication ----------
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        user = authenticate(
            request,
            username=request.data.get("username"),
            password=request.data.get("password"),
        )
        if user is None:
            return Response({"detail": "Invalid username or password."}, status=401)
        login(request, user)  # creates the session the WebSocket will reuse
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response(status=204)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


# ---------- directory ----------
class UserSearchView(generics.ListAPIView):
    """?q=text searches names, ?department=<id> filters by department."""
    serializer_class = UserSerializer
    pagination_class = None

    def get_queryset(self):
        params = self.request.query_params
        users = (
            User.objects.filter(is_active=True)
            .exclude(pk=self.request.user.pk)
            .select_related("department")
        )
        q = params.get("q", "").strip()
        if q:
            users = users.filter(
                Q(username__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
            )
        department = params.get("department")
        if department and department.isdigit():
            users = users.filter(department_id=int(department))
        try:
            limit = max(1, min(int(params.get("limit", 30)), 500))
        except ValueError:
            limit = 30
        return users.order_by("username")[:limit]


class DepartmentListView(generics.ListAPIView):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    pagination_class = None


# ---------- conversations ----------
class ConversationListView(generics.ListAPIView):
    serializer_class = ConversationSerializer
    pagination_class = None

    def get_queryset(self):
        return (
            Conversation.objects.filter(memberships__user=self.request.user)
            .prefetch_related("memberships__user")
            .annotate(last_activity=Max("messages__created_at"))
            .order_by(F("last_activity").desc(nulls_last=True), "-created_at")
        )


class ConversationDetailView(generics.RetrieveAPIView):
    serializer_class = ConversationDetailSerializer
    lookup_url_kwarg = "conversation_id"

    def get_queryset(self):
        return Conversation.objects.filter(
            memberships__user=self.request.user
        ).prefetch_related("memberships__user")


class DirectConversationView(APIView):
    """POST {user_id}: open (or create) the one-to-one chat with that person."""

    def post(self, request):
        try:
            other_id = int(request.data.get("user_id"))
        except (TypeError, ValueError):
            return Response({"detail": "user_id is required."}, status=400)
        if other_id == request.user.id:
            return Response({"detail": "You cannot chat with yourself."}, status=400)
        other = get_object_or_404(User, pk=other_id, is_active=True)

        with transaction.atomic():
            conversation = (
                Conversation.objects.filter(type=Conversation.DIRECT, memberships__user=request.user)
                .filter(memberships__user=other)
                .first()
            )
            created = conversation is None
            if created:
                conversation = Conversation.objects.create(type=Conversation.DIRECT)
                Membership.objects.create(conversation=conversation, user=request.user)
                Membership.objects.create(conversation=conversation, user=other)
        return Response(
            serialize_conversation(conversation, request), status=201 if created else 200
        )


class GroupCreateView(APIView):
    """POST {name, member_ids: [..]}: the creator becomes the group's admin."""

    def post(self, request):
        name = str(request.data.get("name", "")).strip()
        member_ids = parse_ids(request.data.get("member_ids", []))
        if not name or len(name) > 100:
            return Response({"detail": "A group name (max 100 characters) is required."}, status=400)
        if member_ids is None:
            return Response({"detail": "member_ids must be a list of user ids."}, status=400)

        users = User.objects.filter(pk__in=member_ids, is_active=True).exclude(pk=request.user.pk)
        with transaction.atomic():
            conversation = Conversation.objects.create(type=Conversation.GROUP, name=name)
            Membership.objects.create(
                conversation=conversation, user=request.user, role=Membership.ADMIN
            )
            Membership.objects.bulk_create(
                [Membership(conversation=conversation, user=u) for u in users]
            )
        return Response(serialize_conversation(conversation, request, detail=True), status=201)


class GroupMembersView(APIView):
    """POST {user_ids: [..]}: add people to a group (group admins only)."""

    def post(self, request, conversation_id):
        conversation = get_object_or_404(Conversation, pk=conversation_id, type=Conversation.GROUP)
        require_group_admin(request.user, conversation)
        user_ids = parse_ids(request.data.get("user_ids"))
        if not user_ids:
            return Response({"detail": "user_ids must be a non-empty list."}, status=400)
        for user in User.objects.filter(pk__in=user_ids, is_active=True):
            Membership.objects.get_or_create(conversation=conversation, user=user)
        return Response(serialize_conversation(conversation, request, detail=True))


class GroupMemberDetailView(APIView):
    """DELETE: remove a member (group admins) or leave the group (yourself)."""

    def delete(self, request, conversation_id, user_id):
        conversation = get_object_or_404(Conversation, pk=conversation_id, type=Conversation.GROUP)
        if user_id != request.user.id:
            require_group_admin(request.user, conversation)
        membership = get_object_or_404(Membership, conversation=conversation, user_id=user_id)
        membership.delete()
        # Never leave a group without an admin: promote the longest-standing member.
        if not conversation.memberships.filter(role=Membership.ADMIN).exists():
            first = conversation.memberships.order_by("joined_at").first()
            if first:
                first.role = Membership.ADMIN
                first.save(update_fields=["role"])
        return Response(status=204)


class MessageListView(generics.ListAPIView):
    """Newest messages first, 30 per page (?page=2 for older ones)."""
    serializer_class = MessageSerializer

    def get_queryset(self):
        conversation_id = self.kwargs["conversation_id"]
        if not Membership.objects.filter(
            conversation_id=conversation_id, user=self.request.user
        ).exists():
            raise PermissionDenied("You are not a member of this conversation.")
        return (
            Message.objects.filter(conversation_id=conversation_id)
            .select_related("sender")
            .order_by("-created_at")
        )


# ---------- files, images and voice notes ----------

MAX_UPLOAD_MB = getattr(settings, "CHAT_MAX_UPLOAD_MB", 25)

# extension -> (content type, the first bytes a real file of that type starts with)
IMAGE_TYPES = {
    ".png": ("image/png", b"\x89PNG\r\n\x1a\n"),
    ".jpg": ("image/jpeg", b"\xff\xd8\xff"),
    ".jpeg": ("image/jpeg", b"\xff\xd8\xff"),
    ".gif": ("image/gif", b"GIF8"),
    ".webp": ("image/webp", b"RIFF"),
}
AUDIO_TYPES = {  # always treated as audio
    ".ogg": "audio/ogg", ".oga": "audio/ogg", ".mp3": "audio/mpeg",
    ".wav": "audio/wav", ".m4a": "audio/mp4", ".weba": "audio/webm",
}
VOICE_TYPES = {".webm": "audio/webm", ".mp4": "audio/mp4"}  # audio only for recorded voice notes
BLOCKED_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".vbs", ".ps1", ".jar", ".dll", ".sh",
}


def classify_upload(upload, voice):
    """Return the message kind for an uploaded file, or raise a 400 error."""
    
    ext = os.path.splitext(upload.name)[1].lower()
    if ext in BLOCKED_EXTENSIONS:
        raise ValidationError({"detail": f"{ext} files are not allowed."})
    if ext in IMAGE_TYPES:
        upload.seek(0)
        head = upload.read(16)
        upload.seek(0)
        ok = head.startswith(IMAGE_TYPES[ext][1])
        if ext == ".webp":
            ok = ok and head[8:12] == b"WEBP"
        if not ok:
            raise ValidationError({"detail": "This file is not a valid image."})
        return Message.IMAGE
    if ext in AUDIO_TYPES or (voice and ext in VOICE_TYPES):
        return Message.AUDIO
    return Message.FILE


def content_type_for(message):
    ext = os.path.splitext(message.original_name)[1].lower()
    if message.kind == Message.IMAGE and ext in IMAGE_TYPES:
        return IMAGE_TYPES[ext][0]
    if message.kind == Message.AUDIO:
        return AUDIO_TYPES.get(ext) or VOICE_TYPES.get(ext) or "application/octet-stream"
    return "application/octet-stream"


class AttachmentUploadView(APIView):
    """POST multipart {file, caption?, voice?}: send a file, image or voice note."""
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, conversation_id):
        if not Membership.objects.filter(
            conversation_id=conversation_id, user=request.user
        ).exists():
            raise PermissionDenied("You are not a member of this conversation.")
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No file was sent."}, status=400)
        if upload.size == 0:
            return Response({"detail": "This file is empty."}, status=400)
        if upload.size > MAX_UPLOAD_MB * 1024 * 1024:
            return Response({"detail": f"Files are limited to {MAX_UPLOAD_MB} MB."}, status=400)

        voice = str(request.data.get("voice", "")) in ("1", "true")
        kind = classify_upload(upload, voice)
        name = re.sub(r"[\x00-\x1f\x7f]", "", os.path.basename(upload.name))[:255] or "file"
        caption = str(request.data.get("caption", "")).strip()[:2000]

        message = Message(
            conversation_id=conversation_id, sender=request.user, content=caption,
            kind=kind, original_name=name, size=upload.size,
        )
        message.attachment = upload
        message.save()

        payload = message_payload(message)
        async_to_sync(get_channel_layer().group_send)(
            f"chat_{conversation_id}", {"type": "chat.message", "payload": payload}
        )
        return Response(payload, status=201)


def _read_range(file, length, chunk=64 * 1024):
    try:
        while length > 0:
            data = file.read(min(chunk, length))
            if not data:
                break
            length -= len(data)
            yield data
    finally:
        file.close()


class MessageFileView(APIView):
    """GET: download or display an attachment. Only members of the conversation get it."""

    def get(self, request, message_id):
        message = get_object_or_404(Message, pk=message_id)
        if not message.attachment or not Membership.objects.filter(
            conversation_id=message.conversation_id, user=request.user
        ).exists():
            raise Http404  # same answer for "missing" and "not yours"

        size = message.attachment.size
        start, end, status = 0, size - 1, 200
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers.get("Range", ""))
        if match and size and (match.group(1) or match.group(2)):  # audio players seek this way
            first, last = match.groups()
            if first == "":
                start = max(size - int(last), 0)
            else:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            if start > end or start >= size:
                response = HttpResponse(status=416)
                response["Content-Range"] = f"bytes */{size}"
                return response
            status = 206

        file = message.attachment.open("rb")
        file.seek(start)
        response = FileResponse(_read_range(file, end - start + 1), status=status,
                                content_type=content_type_for(message))
        inline = message.kind in (Message.IMAGE, Message.AUDIO) and request.query_params.get("download") != "1"
        response["Content-Disposition"] = content_disposition_header(not inline, message.original_name)
        response["Content-Length"] = str(end - start + 1)
        response["Accept-Ranges"] = "bytes"
        if status == 206:
            response["Content-Range"] = f"bytes {start}-{end}/{size}"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        response["Cache-Control"] = "private, max-age=3600"
        return response
