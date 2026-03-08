from sqlalchemy import (
    Column, Integer, String, Boolean, Float, DateTime, ForeignKey,
    Text, Enum as SAEnum, BigInteger, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


class PlanType(str, enum.Enum):
    starter = "starter"
    pro = "pro"
    business = "business"


class SessionStatus(str, enum.Enum):
    disconnected = "disconnected"
    connecting = "connecting"
    connected = "connected"
    error = "error"


class CampaignStatus(str, enum.Enum):
    draft = "draft"
    running = "running"
    paused = "paused"
    completed = "completed"
    cancelled = "cancelled"


class ContactStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"
    skipped = "skipped"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"
    refunded = "refunded"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    plan = Column(SAEnum(PlanType), default=PlanType.starter, nullable=False)
    plan_expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    dispatch_delay_min = Column(Integer, default=5, nullable=False, server_default="5")
    dispatch_delay_max = Column(Integer, default=15, nullable=False, server_default="15")
    dispatch_daily_limit = Column(Integer, default=200, nullable=False, server_default="200")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    sessions = relationship("WhatsAppSession", back_populates="user", cascade="all, delete-orphan")
    contacts = relationship("Contact", back_populates="user", cascade="all, delete-orphan")
    campaigns = relationship("Campaign", back_populates="user", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="user", cascade="all, delete-orphan")
    daily_stats = relationship("DailyStat", back_populates="user", cascade="all, delete-orphan")
    atividade_logs = relationship("AtividadeLog", back_populates="user", cascade="all, delete-orphan")


class WhatsAppSession(Base):
    __tablename__ = "whatsapp_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    session_id = Column(String(100), unique=True, nullable=False)
    phone_number = Column(String(20), nullable=True)
    status = Column(SAEnum(SessionStatus), default=SessionStatus.disconnected)
    qr_code = Column(Text, nullable=True)
    max_daily_messages = Column(Integer, default=200)
    messages_sent_today = Column(Integer, default=0)
    delay_min = Column(Integer, default=5)   # segundos
    delay_max = Column(Integer, default=15)  # segundos
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="sessions")

    __table_args__ = (
        Index("ix_sessions_user_id", "user_id"),
    )


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    phone = Column(String(20), nullable=False)
    name = Column(String(255), nullable=True)
    is_blacklisted = Column(Boolean, default=False)
    tags = Column(String(500), nullable=True)  # CSV de tags
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="contacts")
    campaign_contacts = relationship("CampaignContact", back_populates="contact")

    __table_args__ = (
        Index("ix_contacts_user_phone", "user_id", "phone"),
        UniqueConstraint("user_id", "phone", name="uq_contacts_user_phone"),
    )


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)       # legado: primeira mensagem
    media_url = Column(String(500), nullable=True)
    status = Column(SAEnum(CampaignStatus), default=CampaignStatus.draft)
    total_contacts = Column(Integer, default=0)
    sent_count = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    fail_count = Column(Integer, default=0)
    session_id = Column(Integer, ForeignKey("whatsapp_sessions.id"), nullable=True)  # legado
    delay_min = Column(Integer, default=5)
    delay_max = Column(Integer, default=15)
    ordem_mensagens = Column(String(20), default="aleatorio", nullable=False, server_default="aleatorio")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="campaigns")
    session = relationship("WhatsAppSession", foreign_keys=[session_id])
    campaign_contacts = relationship("CampaignContact", back_populates="campaign", cascade="all, delete-orphan")
    messages = relationship("CampaignMessage", back_populates="campaign", cascade="all, delete-orphan", order_by="CampaignMessage.ordem")
    campaign_sessions = relationship("CampaignSession", back_populates="campaign", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_campaigns_user_id", "user_id"),
    )


class CampaignContact(Base):
    __tablename__ = "campaign_contacts"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(Integer, ForeignKey("whatsapp_sessions.id", ondelete="SET NULL"), nullable=True)
    status = Column(SAEnum(ContactStatus), default=ContactStatus.pending)
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)

    campaign = relationship("Campaign", back_populates="campaign_contacts")
    contact = relationship("Contact", back_populates="campaign_contacts")
    session = relationship("WhatsAppSession")

    __table_args__ = (
        Index("ix_cc_campaign_id", "campaign_id"),
        Index("ix_cc_status", "status"),
    )


class CampaignMessage(Base):
    __tablename__ = "campaign_messages"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)
    ordem = Column(Integer, default=0, nullable=False)

    campaign = relationship("Campaign", back_populates="messages")

    __table_args__ = (
        Index("ix_campaign_messages_campaign_id", "campaign_id"),
    )


class CampaignSession(Base):
    __tablename__ = "campaign_sessions"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(Integer, ForeignKey("whatsapp_sessions.id", ondelete="CASCADE"), nullable=False)

    campaign = relationship("Campaign", back_populates="campaign_sessions")
    session = relationship("WhatsAppSession")

    __table_args__ = (
        Index("ix_campaign_sessions_campaign_id", "campaign_id"),
    )


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    plan = Column(SAEnum(PlanType), nullable=False)
    amount = Column(Float, nullable=False)
    status = Column(SAEnum(PaymentStatus), default=PaymentStatus.pending)
    mp_payment_id = Column(String(100), nullable=True, index=True)
    mp_subscription_id = Column(String(100), nullable=True)
    mp_preference_id = Column(String(100), nullable=True)
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="payments")


class DailyStat(Base):
    __tablename__ = "daily_stats"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(DateTime(timezone=True), nullable=False)
    messages_sent = Column(Integer, default=0)
    messages_success = Column(Integer, default=0)
    messages_failed = Column(Integer, default=0)

    user = relationship("User", back_populates="daily_stats")

    __table_args__ = (
        Index("ix_daily_stats_user_date", "user_id", "date"),
    )


class AtividadeLog(Base):
    __tablename__ = "atividade_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tipo = Column(String(50), nullable=False)  # contato_extraido, campanha_enviada, sessao_conectada
    descricao = Column(String(500), nullable=False)
    criado_em = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="atividade_logs")

    __table_args__ = (
        Index("ix_atividade_logs_user_id", "user_id"),
    )


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(Integer, ForeignKey("whatsapp_sessions.id", ondelete="CASCADE"), nullable=False)
    group_id_waha = Column(String(100), nullable=False)  # ID do grupo no WAHA (com @g.us)
    name = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=True)  # Nome/tópico do grupo
    member_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_extracted_at = Column(DateTime(timezone=True), nullable=True)
    auto_update_interval = Column(Integer, nullable=True)  # horas, null = desativado
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User")
    session = relationship("WhatsAppSession")
    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_groups_user_id", "user_id"),
        Index("ix_groups_session_id", "session_id"),
        UniqueConstraint("user_id", "group_id_waha", name="uq_groups_user_group"),
    )


class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=True)  # NULL se for member sem contato
    phone = Column(String(20), nullable=False)
    name = Column(String(255), nullable=True)
    is_admin = Column(Boolean, default=False)
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    group = relationship("Group", back_populates="members")
    contact = relationship("Contact")

    __table_args__ = (
        Index("ix_group_members_group_id", "group_id"),
        Index("ix_group_members_contact_id", "contact_id"),
    )
