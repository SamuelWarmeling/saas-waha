from fastapi import APIRouter
import httpx
from config import settings

router = APIRouter(prefix="/api/debug", tags=["debug"])


@router.get("/waha-connection")
async def test_waha_connection():
    """Testa conexão com a WAHA API e retorna resposta completa para debug."""
    url = f"{settings.WAHA_API_URL}/api/sessions"
    headers = {"X-Api-Key": settings.WAHA_API_KEY} if settings.WAHA_API_KEY else {}

    result = {
        "config": {
            "WAHA_API_URL": settings.WAHA_API_URL,
            "WAHA_API_KEY": settings.WAHA_API_KEY[:6] + "***" if settings.WAHA_API_KEY else "(vazio)",
            "WAHA_WEBHOOK_URL": settings.WAHA_WEBHOOK_URL,
        },
        "request": {
            "url": url,
            "headers": {k: (v[:6] + "***" if k == "X-Api-Key" else v) for k, v in headers.items()},
        },
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            result["response"] = {
                "status_code": resp.status_code,
                "ok": resp.status_code < 400,
                "body": resp.text[:2000],
                "headers": dict(resp.headers),
            }
    except httpx.ConnectError as e:
        result["error"] = {"type": "ConnectError", "detail": str(e)}
    except httpx.TimeoutException as e:
        result["error"] = {"type": "TimeoutException", "detail": str(e)}
    except Exception as e:
        result["error"] = {"type": type(e).__name__, "detail": str(e)}

    return result
