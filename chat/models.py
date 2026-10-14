# chat/models.py  (replaces the previous file)
import os
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


def attachment_path(instance, filename):
    """Stored under a random name: the original name is kept in the database only."""
    ext = os.path.splitext(filename)[1].lower()[:10]
    return f"attachments/{timezone.now():%Y/%m}/{uuid.uuid4().hex}{ext}"


class Conversation(models.Model):
    DIRECT = "direct"
    GROUP = "group"
    DEPARTMENT = "department"
    GENERAL = "general"
    TYPE_CHOICES = [
        (DIRECT, "Direct"),
        (GROUP, "Group"),
        (DEPARTMENT, "Department"),
        (GENERAL, "General"),
    ]

    type = models.CharField(max_length=12, choices=TYPE_CHOICES, default=DIRECT)
    name = models.CharField(max_length=100, blank=True)  # groups and department channels
    # Set only for the automatic channel of a department.
    department = models.OneToOneField(
        "users.Department", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="channel",
    )
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL, through="Membership", related_name="conversations"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["type"], condition=models.Q(type="general"), name="only_one_general_chat")
        ]

    def __str__(self):
        return self.name or f"Conversation {self.pk}"


class Membership(models.Model):
    ADMIN = "admin"
    MEMBER = "member"
    ROLE_CHOICES = [(ADMIN, "Admin"), (MEMBER, "Member")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default=MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_message = models.ForeignKey(
        "Message", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        unique_together = ("user", "conversation")

    def __str__(self):
        return f"{self.user} in {self.conversation}"


class Message(models.Model):
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages"
    )
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"
    AUDIO = "audio"
    KIND_CHOICES = [(TEXT, "Text"), (IMAGE, "Image"), (FILE, "File"), (AUDIO, "Voice note")]

    content = models.TextField(blank=True)  # the text, or the caption of an attachment
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=TEXT)
    attachment = models.FileField(upload_to=attachment_path, null=True, blank=True)
    original_name = models.CharField(max_length=255, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["conversation", "created_at"])]

    def __str__(self):
        return f"{self.sender}: {self.content[:30] or self.original_name}"
