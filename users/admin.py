from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Department, User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ("Organisation", {"fields": ("department", "job_title")}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Organisation", {"fields": ("department", "job_title")}),
    )
    list_display = UserAdmin.list_display + ("department",)
    list_filter = UserAdmin.list_filter + ("department",)


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    search_fields = ["name"]