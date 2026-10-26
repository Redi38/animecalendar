from app.ratelimit import SlidingWindow


def test_window_blocks_after_limit_and_recovers():
    t = [0.0]
    w = SlidingWindow(2, 10, clock=lambda: t[0])
    assert w.allow("a") and w.allow("a")
    assert not w.allow("a")
    assert w.allow("b")  # другой клиент не задет
    t[0] = 10.5
    assert w.allow("a")
