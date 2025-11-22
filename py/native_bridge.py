import sys, json, time, platform

_OS = platform.system().lower()

if _OS == 'darwin':
    try:
        from Quartz import (
            CGEventCreateMouseEvent, CGEventPost, kCGHIDEventTap,
            kCGMouseButtonLeft, kCGMouseButtonRight,
            kCGEventMouseMoved, kCGEventLeftMouseDown, kCGEventLeftMouseUp,
            kCGEventRightMouseDown, kCGEventRightMouseUp,
            CGEventCreateScrollWheelEvent, kCGScrollEventUnitPixel
        )
        from Cocoa import NSEvent
    except Exception as e:
        print(json.dumps({"id": 0, "error": f"PyObjC/Quartz not available: {e}"}), flush=True)
        sys.exit(1)

    def _current_pos():
        loc = NSEvent.mouseLocation()
        return (loc.x, loc.y)

    def _post_move(x, y):
        ev = CGEventCreateMouseEvent(None, kCGEventMouseMoved, (float(x), float(y)), kCGMouseButtonLeft)
        CGEventPost(kCGHIDEventTap, ev)

    def _post_click(button='left'):
        if button == 'right':
            dn = CGEventCreateMouseEvent(None, kCGEventRightMouseDown, _current_pos(), kCGMouseButtonRight)
            up = CGEventCreateMouseEvent(None, kCGEventRightMouseUp,   _current_pos(), kCGMouseButtonRight)
        elif button == 'double':
            dn = CGEventCreateMouseEvent(None, kCGEventLeftMouseDown,  _current_pos(), kCGMouseButtonLeft)
            up = CGEventCreateMouseEvent(None, kCGEventLeftMouseUp,    _current_pos(), kCGMouseButtonLeft)
            CGEventPost(kCGHIDEventTap, dn); CGEventPost(kCGHIDEventTap, up)
            time.sleep(0.05)
            CGEventPost(kCGHIDEventTap, dn); CGEventPost(kCGHIDEventTap, up)
            return
        else:
            dn = CGEventCreateMouseEvent(None, kCGEventLeftMouseDown,  _current_pos(), kCGMouseButtonLeft)
            up = CGEventCreateMouseEvent(None, kCGEventLeftMouseUp,    _current_pos(), kCGMouseButtonLeft)
        CGEventPost(kCGHIDEventTap, dn); CGEventPost(kCGHIDEventTap, up)

    def _post_down():
        dn = CGEventCreateMouseEvent(None, kCGEventLeftMouseDown, _current_pos(), kCGMouseButtonLeft)
        CGEventPost(kCGHIDEventTap, dn)

    def _post_up():
        up = CGEventCreateMouseEvent(None, kCGEventLeftMouseUp, _current_pos(), kCGMouseButtonLeft)
        CGEventPost(kCGHIDEventTap, up)

    def _post_scroll(delta):
        ev = CGEventCreateScrollWheelEvent(None, kCGScrollEventUnitPixel, 1, int(delta))
        CGEventPost(kCGHIDEventTap, ev)

elif _OS == 'windows':
    import ctypes, ctypes.wintypes as wt
    user32 = ctypes.WinDLL('user32', use_last_error=True)

    MOUSEEVENTF_MOVE      = 0x0001
    MOUSEEVENTF_LEFTDOWN  = 0x0002
    MOUSEEVENTF_LEFTUP    = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP   = 0x0010
    MOUSEEVENTF_WHEEL     = 0x0800

    def _set_pos(x, y): user32.SetCursorPos(int(x), int(y))
    def _post_move(x, y): _set_pos(x, y)
    def _post_click(button='left'):
        if button == 'right':
            user32.mouse_event(MOUSEEVENTF_RIGHTDOWN,0,0,0,0)
            user32.mouse_event(MOUSEEVENTF_RIGHTUP,0,0,0,0)
        elif button == 'double':
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,0); user32.mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,0)
            time.sleep(0.05)
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,0); user32.mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,0)
        else:
            user32.mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,0)
            user32.mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,0)
    def _post_down(): user32.mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,0)
    def _post_up():   user32.mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,0)
    def _post_scroll(delta): user32.mouse_event(MOUSEEVENTF_WHEEL,0,0,int(delta),0)
else:
    print(json.dumps({"id": 0, "error": f"Unsupported OS: {_OS}"}), flush=True)
    sys.exit(1)

def handle(method, params):
    if method == 'move':
        _post_move(params.get('x', 0), params.get('y', 0)); return {"ok": True}
    if method == 'click':
        b = params.get('button', 'left'); _post_click(b);  return {"ok": True}
    if method == 'mouse':
        a = params.get('action', '')
        if a == 'down': _post_down()
        elif a == 'up': _post_up()
        else: return {"ok": False, "error": f"unknown mouse action: {a}"}
        return {"ok": True}
    if method == 'scroll':
        _post_scroll(int(params.get('delta', 0))); return {"ok": True}
    return {"ok": False, "error": f"unknown method: {method}"}

def main():
    for line in sys.stdin:
      line = line.strip()
      if not line: continue
      try:
        msg = json.loads(line)
        rid = msg.get('id', 0)
        res = handle(msg.get('method'), msg.get('params', {}))
        res['id'] = rid
        print(json.dumps(res), flush=True)
      except Exception as e:
        print(json.dumps({"id": 0, "error": f"{type(e).__name__}: {e}"}), flush=True)

if __name__ == '__main__':
    main()
