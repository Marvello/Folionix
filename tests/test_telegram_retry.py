import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock

# Need to set env vars before import
os.environ.setdefault("TELEGRAM_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_CHAT_ID", "123")

from app.fetch_portfolio import send_telegram_request

def test_retry_on_failure():
    mock_resp_fail = MagicMock()
    mock_resp_fail.status_code = 500
    mock_resp_fail.text = "Internal Server Error"

    mock_resp_ok = MagicMock()
    mock_resp_ok.status_code = 200

    with patch("app.fetch_portfolio.requests.post", side_effect=[mock_resp_fail, mock_resp_ok]):
        with patch("app.fetch_portfolio.time.sleep"):  # skip actual sleep
            result = send_telegram_request("test msg", "123")
            assert result is True

def test_gives_up_after_max_retries():
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "Internal Server Error"

    with patch("app.fetch_portfolio.requests.post", return_value=mock_resp):
        with patch("app.fetch_portfolio.time.sleep"):
            result = send_telegram_request("test msg", "123")
            assert result is False

def test_success_on_first_try():
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch("app.fetch_portfolio.requests.post", return_value=mock_resp):
        result = send_telegram_request("test msg", "123")
        assert result is True
