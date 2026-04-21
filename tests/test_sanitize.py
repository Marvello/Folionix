import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bot import sanitize_ticker
from utils import sanitize_html

def test_sanitize_ticker_valid():
    assert sanitize_ticker("BBCA") == "BBCA"
    assert sanitize_ticker("bbca") == "BBCA"
    assert sanitize_ticker("BBCA1") == "BBCA1"

def test_sanitize_ticker_invalid():
    assert sanitize_ticker("") is None
    assert sanitize_ticker("BB CA") is None
    assert sanitize_ticker("BBCA.JK") is None
    assert sanitize_ticker("A" * 11) is None
    assert sanitize_ticker("ticker; rm -rf") is None

def test_sanitize_html_keeps_allowed():
    html = "<b>Bold</b> <i>Italic</i> <code>Code</code>"
    assert sanitize_html(html) == html

def test_sanitize_html_strips_script():
    assert "<script>" not in sanitize_html("<script>alert('xss')</script>")

def test_sanitize_html_strips_div():
    assert "<div>" not in sanitize_html("<div><b>Hello</b></div>")
