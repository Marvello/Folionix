"""Long-running entry point for LangGraph orchestrator."""

import logging
import signal
import time

from app.db import init_db
from app.graph.orchestrator import build_orchestrator_graph, get_sleep_interval
from app.graph.state import initial_orchestrator_state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger(__name__)

_shutdown = False


def _handle_sigterm(signum, frame):
    global _shutdown
    log.info("SIGTERM received — finishing current cycle and shutting down")
    _shutdown = True


def main():
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    log.info("IDX Graph Orchestrator starting")
    init_db()

    graph = build_orchestrator_graph()
    state = initial_orchestrator_state()

    while not _shutdown:
        log.info(f"Cycle start — session: {state['current_session']}")
        try:
            state = graph.invoke(state)
        except Exception as e:
            log.error(f"Orchestrator error: {e}", exc_info=True)

        sleep_sec = get_sleep_interval(state["current_session"])
        log.info(f"Sleeping {sleep_sec}s (session: {state['current_session']})")

        elapsed = 0
        while elapsed < sleep_sec and not _shutdown:
            time.sleep(min(10, sleep_sec - elapsed))
            elapsed += 10

    log.info("Orchestrator shut down cleanly")


if __name__ == "__main__":
    main()
