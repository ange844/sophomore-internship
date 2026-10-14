# chat/consumers.py
# Assumes the models from the plan: Membership(user, conversation) and
# Message(conversation, sender, content, created_at).
import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from . import presence
from .models import Membership, Message
from .serializers import message_payload


class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        self.conversation_id = int(self.scope["url_route"]["kwargs"]["conversation_id"])
        self.group_name = f"chat_{self.conversation_id}"

        # Reject anonymous users and people who are not members of the conversation.
        if not self.user.is_authenticated or not await self.is_member():
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            content = json.loads(text_data).get("content", "").strip()
        except (json.JSONDecodeError, AttributeError):
            return
        if not content:
            return

        payload = await self.save_message(content)  # persist first, then broadcast
        await self.channel_layer.group_send(self.group_name, {
            "type": "chat.message",  # calls chat_message() on every member's consumer
            "payload": payload,
        })

    async def chat_message(self, event):
        await self.send(text_data=json.dumps(event["payload"]))

    # ORM calls are synchronous, so they run in a worker thread.
    @database_sync_to_async
    def is_member(self):
        return Membership.objects.filter(
            conversation_id=self.conversation_id, user=self.user
        ).exists()

    @database_sync_to_async
    def save_message(self, content):
        message = Message.objects.create(
            conversation_id=self.conversation_id, sender=self.user, content=content
        )
        return message_payload(message)


class PresenceConsumer(AsyncWebsocketConsumer):
    """One per open page: tells everyone this user is online, and tells this page who is."""

    async def connect(self):
        self.user = self.scope["user"]
        self.registered = False
        if not self.user.is_authenticated:
            await self.close(code=4403)
            return
        await self.channel_layer.group_add(presence.GROUP, self.channel_name)
        await self.accept()
        await presence.user_connected(self.user.id)
        self.registered = True
        await self.send(text_data=json.dumps({"event": "snapshot", "online": presence.online_ids()}))

    async def disconnect(self, code):
        await self.channel_layer.group_discard(presence.GROUP, self.channel_name)
        if self.registered:
            await presence.user_disconnected(self.user.id)

    async def receive(self, text_data=None, bytes_data=None):
        pass  # clients only listen

    async def presence_update(self, event):
        await self.send(text_data=json.dumps({
            "event": "update",
            "user_id": event["user_id"],
            "online": event["online"],
            "last_seen": event["last_seen"],
        }))
