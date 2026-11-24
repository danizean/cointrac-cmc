import threading

from supabase import Client, create_client

from app.core.config import get_settings

# The Supabase sync client owns one HTTP connection. Sharing it across threads
# corrupts HTTP/2 reads (WinError 10035 on Windows). Each thread keeps its own
# client so concurrent quota calls stay parallel without sharing that socket.
_clients = threading.local()


def supabase_client() -> Client:
    settings = get_settings()
    url = settings.supabase_url.strip()
    key = settings.supabase_service_role_key.get_secret_value().strip()
    if not url or not key or key.startswith("your_"):
        raise RuntimeError("Supabase is not configured")
    identity = (url, key)
    client = getattr(_clients, "client", None)
    if client is None or getattr(_clients, "identity", None) != identity:
        client = create_client(url, key)
        _clients.client = client
        _clients.identity = identity
    return client
