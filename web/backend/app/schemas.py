from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class DomainCreate(BaseModel):
    domain: str
    dnsChannelId: str
    enabled: bool = True


class DomainPatch(BaseModel):
    domain: str | None = None
    dnsChannelId: str | None = None
    enabled: bool | None = None


class DnsChannelCreate(BaseModel):
    name: str
    provider: str
    credentials: dict[str, str] = Field(default_factory=dict)


class DnsChannelPatch(BaseModel):
    name: str | None = None
    provider: str | None = None
    credentials: dict[str, str] | None = None


class NodeCreate(BaseModel):
    name: str
    ip: str = ""
    certDir: str = "/etc/nginx/ssl"


class NodePatch(BaseModel):
    name: str | None = None
    ip: str | None = None
    certDir: str | None = None
    lastError: str | None = None


class AssignmentUpdate(BaseModel):
    domainIds: list[str]


class WebDavSettings(BaseModel):
    url: str
    auth: str


class TelegramSettings(BaseModel):
    botToken: str
    chatId: str


class AcmeSettings(BaseModel):
    acmeHome: str
    stagingBase: str
    defaultRenewDays: int


class SettingsPayload(BaseModel):
    webdav: WebDavSettings
    telegram: TelegramSettings
    acme: AcmeSettings


class NodeHeartbeat(BaseModel):
    hostname: str | None = None
    ip: str | None = None
    version: str | None = None
    certDir: str | None = None


class NodeReportItem(BaseModel):
    domainId: str
    deployedSha256: str | None = None
    status: str
    expiresAt: str | None = None
    lastError: str | None = None


class NodeReport(BaseModel):
    items: list[NodeReportItem]
