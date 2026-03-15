import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database import SessionLocal
from models import User, PlanType
from datetime import datetime, timezone

db = SessionLocal()
email = "fyeinvestidor@gmail.com"
user = db.query(User).filter(User.email == email).first()
if user:
    user.is_active = True
    user.trial_ativo = False
    user.trial_expira_em = None
    user.plan = PlanType.pro
    user.plan_expires_at = datetime(2099, 12, 31, tzinfo=timezone.utc)
    user.chips_disparo_simultaneo = 3
    db.commit()
    print(f"✅ Plano vitalício ativado para {user.email}")
    print(f"   plan={user.plan}, expira={user.plan_expires_at}, chips={user.chips_disparo_simultaneo}")
else:
    print(f"❌ Usuário {email} não encontrado")
db.close()
