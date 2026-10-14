# users/models.py  (replaces the previous file)
from django.contrib.auth.models import AbstractUser
from django.db import models


class Department(models.Model):
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class User(AbstractUser):
    department = models.ForeignKey(
        Department, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="members",
    )
    job_title = models.CharField(max_length=100, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)  # set when the user goes offline
