# chat/page_views.py  (new file) - one view per HTML page
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render

from .models import Conversation

needs_login = login_required(login_url="/login/")


def home(request):
    return redirect("/chat/" if request.user.is_authenticated else "/login/")


def login_page(request):
    if request.user.is_authenticated:
        return redirect("/chat/")
    return render(request, "chat/login.html")


@needs_login
def chat_page(request):
    return render(request, "chat/chat.html")


@needs_login
def people_page(request):
    return render(request, "chat/people.html")


@needs_login
def new_chat_page(request):
    return render(request, "chat/new_chat.html")


@needs_login
def new_group_page(request):
    return render(request, "chat/new_group.html")


@needs_login
def members_page(request, conversation_id):
    conversation = get_object_or_404(
        Conversation, pk=conversation_id, memberships__user=request.user
    )
    if conversation.type == Conversation.DIRECT:  # nothing to manage in a 1-to-1 chat
        return redirect(f"/chat/?c={conversation.pk}")
    return render(request, "chat/members.html", {"conversation_id": conversation.pk})
