# chat/management/commands/setup_general_chat.py  (new file)
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from chat.models import Membership
from chat.signals import general_channel


class Command(BaseCommand):
    help = "Create the company-wide General chat and add every active user to it."

    def handle(self, *args, **options):
        channel = general_channel()
        added = 0
        for user in get_user_model().objects.filter(is_active=True):
            _, created = Membership.objects.get_or_create(user=user, conversation=channel)
            added += int(created)
        self.stdout.write(self.style.SUCCESS(f"General chat ready; {added} user(s) added."))
