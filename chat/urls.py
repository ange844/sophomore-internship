# chat/urls.py  (replaces the previous file)
from django.urls import path

from . import views

urlpatterns = [
    path("auth/login/", views.LoginView.as_view()),
    path("auth/logout/", views.LogoutView.as_view()),
    path("auth/me/", views.MeView.as_view()),
    path("users/", views.UserSearchView.as_view()),
    path("departments/", views.DepartmentListView.as_view()),
    path("conversations/", views.ConversationListView.as_view()),
    path("conversations/direct/", views.DirectConversationView.as_view()),
    path("conversations/group/", views.GroupCreateView.as_view()),
    path("conversations/<int:conversation_id>/", views.ConversationDetailView.as_view()),
    path("conversations/<int:conversation_id>/messages/", views.MessageListView.as_view()),
    path("conversations/<int:conversation_id>/attachments/", views.AttachmentUploadView.as_view()),
    path("messages/<int:message_id>/file/", views.MessageFileView.as_view()),
    path("conversations/<int:conversation_id>/members/", views.GroupMembersView.as_view()),
    path(
        "conversations/<int:conversation_id>/members/<int:user_id>/",
        views.GroupMemberDetailView.as_view(),
    ),
]
