# bad.py — every executable line below must be flagged.
import requests
import httpx


def a():
    return requests.get("https://api.example.com/data")  # SHOULD flag


def b():
    return requests.post("https://api.example.com/users", json=payload)  # SHOULD flag


def c():
    r = httpx.get("https://api.example.com/x")  # SHOULD flag
    return r.json()


def d():
    client = httpx.Client(base_url="https://api.example.com")  # SHOULD flag
    return client
