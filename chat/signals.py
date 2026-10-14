# chat/signals.py  (replaces the previous file)
# Keeps the automatic channels in sync:
#   - each department has a channel; changing a user's department moves them between channels
#   - one company-wide "General" chat that every new user joins automatically
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from users.models import Department, User

from .models import Conversation, Membership


# ---------- General chat ----------
def general_channel():
    channel, _ = Conversation.objects.get_or_create(
        type=Conversation.GENERAL, defaults={"name": "General"}
    )
    return channel


@receiver(post_save, sender=User)
def join_general_chat(sender, instance, created, **kwargs):
    if created:
        Membership.objects.get_or_create(user=instance, conversation=general_channel())


# ---------- Department channels ----------
def channel_for(department):
    channel, created = Conversation.objects.get_or_create(
        department=department,
        defaults={"type": Conversation.DEPARTMENT, "name": department.name},
    )
    if not created and channel.name != department.name:
        channel.name = department.name
        channel.save(update_fields=["name"])
    return channel


@receiver(post_save, sender=Department)
def department_saved(sender, instance, **kwargs):
    channel_for(instance)


@receiver(pre_save, sender=User)
def remember_old_department(sender, instance, **kwargs):
    if instance.pk:
        instance._old_department_id = (
            User.objects.filter(pk=instance.pk)
            .values_list("department_id", flat=True)
            .first()
        )
    else:
        instance._old_department_id = None


@receiver(post_save, sender=User)
def sync_department_membership(sender, instance, **kwargs):
    old = getattr(instance, "_old_department_id", None)
    new = instance.department_id
    if old == new:
        return
    if old:
        Membership.objects.filter(user=instance, conversation__department_id=old).delete()
    if new:
        Membership.objects.get_or_create(
            user=instance, conversation=channel_for(instance.department)
        )
    instance._old_department_id = new
