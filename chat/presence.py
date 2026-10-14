# chat/presence.py  (new file)
# Tracks who is online. Every logged-in page keeps one "presence" WebSocket open
# (see PresenceConsumer); a user is online while at least one of them is connected.
#
# The state lives in this process's memory, which is correct while the server runs as a
# single Daphne process (the same assumption as the in-memory channel layer). Moving to
# several worker processes means keeping this state in Redis instead.
import asyncio

from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from django.utils import timezone

GROUP = "presence"       # every presence socket joins this channel-layer group
GRACE_SECONDS = 8        # navigating between pages briefly closes the socket: don't flicker

_connections = {}        # user id -> number of open presence sockets
_online = set()          # user ids announced as online
_pending = {}            # user id -> task that will announce "offline" after the grace period


def is_online(user_id):
    return user_id in _online


def online_ids():
    return sorted(_online)


async def _broadcast(user_id, online, last_seen=None):
    await get_channel_layer().group_send(GROUP, {
        "type": "presence.update",
        "user_id": user_id,
        "online": online,
        "last_seen": last_seen.isoformat() if last_seen else None,
    })


async def user_connected(user_id):
    _connections[user_id] = _connections.get(user_id, 0) + 1
    task = _pending.pop(user_id, None)
    if task:
        task.cancel()  # came back within the grace period: never went offline
    if user_id not in _online:
        _online.add(user_id)
        await _broadcast(user_id, True)


async def user_disconnected(user_id):
    remaining = _connections.get(user_id, 1) - 1
    if remaining > 0:  # still connected from another tab or page
        _connections[user_id] = remaining
        return
    _connections.pop(user_id, None)
    _pending[user_id] = asyncio.ensure_future(_announce_offline(user_id, timezone.now()))


async def _announce_offline(user_id, left_at):
    try:
        await asyncio.sleep(GRACE_SECONDS)
    except asyncio.CancelledError:
        return
    _pending.pop(user_id, None)
    if user_id in _connections:
        return
    _online.discard(user_id)
    await _save_last_seen(user_id, left_at)
    if user_id not in _connections:  # may have reconnected while saving
        await _broadcast(user_id, False, left_at)


@database_sync_to_async
def _save_last_seen(user_id, left_at):
    from users.models import User
    User.objects.filter(pk=user_id).update(last_seen=left_at)  # update(): no signals fired
