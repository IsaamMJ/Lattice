# good.py — none of these may be flagged.
import requests
import httpx


# Calls WITH a timeout:
def with_timeout():
    return requests.get("https://api.example.com/data", timeout=5)


def post_with_timeout():
    return requests.post("https://api.example.com/users", json=payload, timeout=10)


def httpx_with_timeout():
    return httpx.get("https://api.example.com/x", timeout=5.0)


def httpx_client_with_timeout():
    return httpx.Client(base_url="https://api.example.com", timeout=30)


def with_timeout_multiline():
    return requests.get(
        "https://api.example.com/data",
        timeout=5,
    )


# Commented-out network calls must NOT flag:
# return requests.get("https://api.example.com/data")
#    httpx.get("https://api.example.com/x")


# Non-network code that merely mentions the words:
def not_network():
    requests_made = 0          # identifier contains "requests" but no call
    config = {"httpx": True}   # dict key, not a call
    return requests_made
