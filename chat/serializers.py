# chat/serializers.py  (replaces the previous file)
import json

from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework.renderers import JSONRenderer

from users.models import Department

from . import presence
from .models import Conversation, Membership, Message

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    department = serializers.SerializerMethodField()
    online = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "first_name", "last_name",
            "department", "job_title", "online", "last_seen",
        ]

    def get_department(self, obj):
        return obj.department.name if obj.department_id else None

    def get_online(self, obj):
        return presence.is_online(obj.pk)


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name"]


class MessageSerializer(serializers.ModelSerializer):
    # Same shape as the messages the WebSocket consumer broadcasts.
    sender = serializers.CharField(source="sender.username", read_only=True)
    timestamp = serializers.DateTimeField(source="created_at", read_only=True)
    attachment = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "sender", "content", "timestamp", "kind", "attachment"]

    def get_attachment(self, obj):
        if not obj.attachment:
            return None
        # Files are never served from a public URL: this view checks membership.
        return {"name": obj.original_name, "size": obj.size, "url": f"/api/messages/{obj.pk}/file/"}


def message_payload(message):
    """JSON-safe dict of a message: what the WebSocket broadcasts to the conversation."""
    return json.loads(JSONRenderer().render(MessageSerializer(message).data))


class ConversationSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    peer = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ["id", "type", "title", "last_message", "peer"]

    def get_title(self, obj):
        if obj.type != Conversation.DIRECT and obj.name:
            return obj.name
        me = self.context["request"].user
        others = [m.user.username for m in obj.memberships.all() if m.user_id != me.id]
        return ", ".join(others) or obj.name or f"Conversation {obj.pk}"

    def get_last_message(self, obj):
        message = obj.messages.order_by("-created_at").first()
        return MessageSerializer(message).data if message else None

    def get_peer(self, obj):
        """For one-to-one chats: the other person and whether they are online."""
        if obj.type != Conversation.DIRECT:
            return None
        me = self.context["request"].user
        for m in obj.memberships.all():
            if m.user_id != me.id:
                last_seen = m.user.last_seen
                return {
                    "id": m.user_id,
                    "online": presence.is_online(m.user_id),
                    "last_seen": last_seen.isoformat() if last_seen else None,
                }
        return None


class MemberSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user.id")
    username = serializers.CharField(source="user.username")
    online = serializers.SerializerMethodField()
    last_seen = serializers.DateTimeField(source="user.last_seen", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "username", "role", "online", "last_seen"]

    def get_online(self, obj):
        return presence.is_online(obj.user_id)


class ConversationDetailSerializer(ConversationSerializer):
    members = MemberSerializer(source="memberships", many=True, read_only=True)
    my_role = serializers.SerializerMethodField()

    class Meta(ConversationSerializer.Meta):
        fields = ConversationSerializer.Meta.fields + ["members", "my_role"]

    def get_my_role(self, obj):
        me = self.context["request"].user
        for m in obj.memberships.all():
            if m.user_id == me.id:
                return m.role
        return None
