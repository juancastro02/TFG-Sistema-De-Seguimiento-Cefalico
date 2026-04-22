
import sys
import json
import os
import shutil
import subprocess

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

HAS_XDOTOOL = (
    not USE_QUARTZ
    and sys.platform.startswith("linux")
    and bool(os.environ.get("DISPLAY"))
    and shutil.which("xdotool") is not None
)
FORCED_BACKEND = os.environ.get("PY_MOUSE_BACKEND", "").strip().lower()
USE_XDOTOOL = FORCED_BACKEND == "xdotool" and HAS_XDOTOOL

pyautogui = None
BACKEND_ERROR = None
if not USE_QUARTZ and not USE_XDOTOOL:
    try:
        import pyautogui
        pyautogui.PAUSE = 0      
        pyautogui.FAILSAFE = False
    except Exception as exc:
        BACKEND_ERROR = str(exc)

if not USE_QUARTZ and pyautogui is None and not USE_XDOTOOL and HAS_XDOTOOL:
    USE_XDOTOOL = True

KEYBOARD_BACKEND = pyautogui
if KEYBOARD_BACKEND is None:
    try:
        import pyautogui as keyboard_pyautogui
        keyboard_pyautogui.PAUSE = 0
        keyboard_pyautogui.FAILSAFE = False
        KEYBOARD_BACKEND = keyboard_pyautogui
    except Exception:
        KEYBOARD_BACKEND = None

if not USE_QUARTZ and sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
    BACKEND_ERROR = (
        "DISPLAY no definido. En Ubuntu ejecuta la app dentro de una sesion X11/XWayland "
        "para permitir el control del cursor."
    )

if USE_XDOTOOL:
    sys.stderr.write("[mouse_server] Backend Linux activo: xdotool\n")
    sys.stderr.flush()
elif not USE_QUARTZ and pyautogui is not None:
    sys.stderr.write("[mouse_server] Backend Linux activo: pyautogui\n")
    sys.stderr.flush()


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
    if USE_XDOTOOL:
        BUTTON_MAP = {
            "left": "1",
            "middle": "2",
            "right": "3",
        }

        def run_xdotool(*args):
            try:
                subprocess.run(
                    ["xdotool", *args],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                )
            except subprocess.CalledProcessError as exc:
                detail = exc.stderr.strip() if exc.stderr else "xdotool fallo"
                raise RuntimeError(detail) from exc

        def q_move(x, y):
            run_xdotool("mousemove", "--sync", str(int(x)), str(int(y)))

        def q_click(button="left"):
            if button == "double":
                run_xdotool("click", "--repeat", "2", "--delay", "120", BUTTON_MAP["left"])
            else:
                run_xdotool("click", BUTTON_MAP.get(button, BUTTON_MAP["left"]))

        def q_down(button="left"):
            run_xdotool("mousedown", BUTTON_MAP.get(button, BUTTON_MAP["left"]))

        def q_up(button="left"):
            run_xdotool("mouseup", BUTTON_MAP.get(button, BUTTON_MAP["left"]))

        def q_scroll(dx=0, dy=0):
            if dy:
                button = "4" if dy > 0 else "5"
                amount = max(1, round(abs(dy) / 120))
                run_xdotool("click", "--repeat", str(amount), button)

            if dx:
                button = "7" if dx > 0 else "6"
                amount = max(1, round(abs(dx) / 120))
                run_xdotool("click", "--repeat", str(amount), button)

        def q_type_text(text):
            if not text:
                return
            run_xdotool("type", "--delay", "1", text)

        def q_press_key(key):
            key_map = {
                "enter": "Return",
                "return": "Return",
                "tab": "Tab",
                "space": "space",
                "backspace": "BackSpace",
            }
            run_xdotool("key", key_map.get(key.lower(), key))

        def q_delete_last_word():
            run_xdotool("key", "ctrl+BackSpace")

    elif pyautogui is None:
        def q_move(x, y):
            raise RuntimeError(BACKEND_ERROR or "Backend de mouse no disponible")

        def q_click(button="left"):
            raise RuntimeError(BACKEND_ERROR or "Backend de mouse no disponible")

        def q_down(button="left"):
            raise RuntimeError(BACKEND_ERROR or "Backend de mouse no disponible")

        def q_up(button="left"):
            raise RuntimeError(BACKEND_ERROR or "Backend de mouse no disponible")

        def q_scroll(dx=0, dy=0):
            raise RuntimeError(BACKEND_ERROR or "Backend de mouse no disponible")

        def q_type_text(text):
            raise RuntimeError(BACKEND_ERROR or "Backend de teclado no disponible")

        def q_press_key(key):
            raise RuntimeError(BACKEND_ERROR or "Backend de teclado no disponible")

        def q_delete_last_word():
            raise RuntimeError(BACKEND_ERROR or "Backend de teclado no disponible")
    else:
        def q_move(x, y):
            pyautogui.moveTo(int(x), int(y), duration=0)

        def q_click(button="left"):
            if button == "double":
                pyautogui.doubleClick(button="left", interval=0.12)
            elif button == "right":
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

        def q_type_text(text):
            if text:
                KEYBOARD_BACKEND.write(str(text), interval=0)

        def q_press_key(key):
            normalized = str(key).lower()
            if normalized in ("enter", "return"):
                KEYBOARD_BACKEND.press("enter")
            elif normalized == "tab":
                KEYBOARD_BACKEND.press("tab")
            elif normalized == "space":
                KEYBOARD_BACKEND.press("space")
            elif normalized == "backspace":
                KEYBOARD_BACKEND.press("backspace")
            else:
                KEYBOARD_BACKEND.press(normalized)

        def q_delete_last_word():
            if sys.platform == "darwin":
                KEYBOARD_BACKEND.hotkey("option", "backspace")
            else:
                KEYBOARD_BACKEND.hotkey("ctrl", "backspace")



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

        if method == "type_text":
            text = str(msg.get("text", ""))
            q_type_text(text)
            qprint({"id": mid, "ok": True})
            return

        if method == "press_key":
            key = str(msg.get("key", ""))
            q_press_key(key)
            qprint({"id": mid, "ok": True})
            return

        if method == "delete_last_word":
            q_delete_last_word()
            qprint({"id": mid, "ok": True})
            return

        qprint({"id": mid, "ok": False, "error": "unknown method"})

    except Exception as e:
        qprint({"id": mid, "ok": False, "error": str(e)})


if __name__ == "__main__":
    if not USE_QUARTZ and not USE_XDOTOOL and pyautogui is None:
        sys.stderr.write((BACKEND_ERROR or "No se pudo inicializar pyautogui") + "\n")
        sys.stderr.flush()
        sys.exit(1)
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
