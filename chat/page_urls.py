# chat/page_urls.py  (new file) - the URLs of the HTML pages
from django.urls import path

from . import page_views

urlpatterns = [
    path("", page_views.home),
    path("login/", page_views.login_page),
    path("chat/", page_views.chat_page),
    path("chat/people/", page_views.people_page),
    path("chat/new/", page_views.new_chat_page),
    path("chat/new-group/", page_views.new_group_page),
    path("chat/<int:conversation_id>/members/", page_views.members_page),
]
