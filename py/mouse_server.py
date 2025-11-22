
import sys
import json

USE_QUARTZ = False
try:
    from Quartz import (
        CGEventCreateMouseEvent,
        CGEventPost,
        kCGHIDEventTap,
        kCGEventMouseMoved,
        kCGEventLeftMouseDown,
        kCGEventLeftMouseUp,
        kCGEventRightMouseDown,
        kCGEventRightMouseUp,
        CGEventCreateScrollWheelEvent,
        kCGScrollEventUnitLine,
        CGMainDisplayID,
        CGDisplayPixelsHigh,
        CGDisplayPixelsWide,
        CGPointMake,
        CGEventSetFlags,
        kCGEventFlagMaskControl,
    )
    USE_QUARTZ = True
except Exception:
    pass

pyautogui = None
if not USE_QUARTZ:
    try:
        import pyautogui
        pyautogui.PAUSE = 0      
        pyautogui.FAILSAFE = False
    except Exception:
        pass


def qprint(obj):
    """Escribe una respuesta JSON por stdout (1 línea)."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if USE_QUARTZ:
    MAIN_ID = CGMainDisplayID()
    SCR_W = int(CGDisplayPixelsWide(MAIN_ID))
    SCR_H = int(CGDisplayPixelsHigh(MAIN_ID))

    LAST_X = SCR_W // 2
    LAST_Y = SCR_H // 2

    def q_move(x, y):
        """Mover el cursor a (x, y) y recordar esa posición."""
        global LAST_X, LAST_Y
        LAST_X = int(x)
        LAST_Y = int(y)
        ev = CGEventCreateMouseEvent(
            None,
            kCGEventMouseMoved,
            CGPointMake(LAST_X, LAST_Y),
            0,
        )
        CGEventPost(kCGHIDEventTap, ev)

    def q_click(button="left"):
        """Click en la última posición conocida.

        - left  -> click normal
        - right -> Ctrl + click (menú contextual en macOS)
        """
        global LAST_X, LAST_Y
        x = LAST_X
        y = LAST_Y

        if button == "right":
            evd = CGEventCreateMouseEvent(
                None,
                kCGEventLeftMouseDown,
                CGPointMake(x, y),
                0,
            )
            CGEventSetFlags(evd, kCGEventFlagMaskControl)
            CGEventPost(kCGHIDEventTap, evd)

            evu = CGEventCreateMouseEvent(
                None,
                kCGEventLeftMouseUp,
                CGPointMake(x, y),
                0,
            )
            CGEventSetFlags(evu, kCGEventFlagMaskControl)
            CGEventPost(kCGHIDEventTap, evu)
        else:
            # Click izquierdo normal
            evd = CGEventCreateMouseEvent(
                None,
                kCGEventLeftMouseDown,
                CGPointMake(x, y),
                0,
            )
            CGEventPost(kCGHIDEventTap, evd)

            evu = CGEventCreateMouseEvent(
                None,
                kCGEventLeftMouseUp,
                CGPointMake(x, y),
                0,
            )
            CGEventPost(kCGHIDEventTap, evu)

    def q_down(button="left"):
        """Mouse down en la última posición conocida (para drag)."""
        global LAST_X, LAST_Y
        x = LAST_X
        y = LAST_Y

        if button == "right":
            evd = CGEventCreateMouseEvent(
                None,
                kCGEventRightMouseDown,
                CGPointMake(x, y),
                1,
            )
        else:
            evd = CGEventCreateMouseEvent(
                None,
                kCGEventLeftMouseDown,
                CGPointMake(x, y),
                0,
            )

        CGEventPost(kCGHIDEventTap, evd)

    def q_up(button="left"):
        """Mouse up en la última posición conocida (fin de drag)."""
        global LAST_X, LAST_Y
        x = LAST_X
        y = LAST_Y

        if button == "right":
            evu = CGEventCreateMouseEvent(
                None,
                kCGEventRightMouseUp,
                CGPointMake(x, y),
                1,
            )
        else:
            evu = CGEventCreateMouseEvent(
                None,
                kCGEventLeftMouseUp,
                CGPointMake(x, y),
                0,
            )

        CGEventPost(kCGHIDEventTap, evu)

    def q_scroll(dx=0, dy=0):
        ev = CGEventCreateScrollWheelEvent(
            None,
            kCGScrollEventUnitLine,
            2,
            int(dy),
            int(dx),
        )
        CGEventPost(kCGHIDEventTap, ev)

else:
    if pyautogui is None:
        def q_move(x, y):
            pass

        def q_click(button="left"):
            pass

        def q_down(button="left"):
            pass

        def q_up(button="left"):
            pass

        def q_scroll(dx=0, dy=0):
            pass
    else:
        def q_move(x, y):
            pyautogui.moveTo(int(x), int(y), duration=0)

        def q_click(button="left"):
            if button == "right":
                pyautogui.click(button="right")
            else:
                pyautogui.click()

        def q_down(button="left"):
            pyautogui.mouseDown(button=button)

        def q_up(button="left"):
            pyautogui.mouseUp(button=button)

        def q_scroll(dx=0, dy=0):
            if dy:
                pyautogui.scroll(int(dy))



def handle(msg):
    mid = msg.get("id", None)
    method = msg.get("method")
    try:
        if method == "ready":
            qprint({"id": mid, "ok": True, "result": "ready"})
            return

        if method == "move":
            x = msg.get("x", 0)
            y = msg.get("y", 0)
            q_move(x, y)
            qprint({"id": mid, "ok": True})
            return

        if method == "click":
            button = msg.get("button", "left")
            q_click(button)
            qprint({"id": mid, "ok": True})
            return

        if method == "down":
            button = msg.get("button", "left")
            q_down(button)
            qprint({"id": mid, "ok": True})
            return

        if method == "up":
            button = msg.get("button", "left")
            q_up(button)
            qprint({"id": mid, "ok": True})
            return

        if method == "scroll":
            dx = int(msg.get("dx", 0))
            dy = int(msg.get("dy", 0))
            q_scroll(dx, dy)
            qprint({"id": mid, "ok": True})
            return

        qprint({"id": mid, "ok": False, "error": "unknown method"})

    except Exception as e:
        qprint({"id": mid, "ok": False, "error": str(e)})


if __name__ == "__main__":
    qprint({"id": 0, "ok": True, "result": "boot"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            qprint({"ok": False, "error": "bad json"})
            continue
        handle(msg)
