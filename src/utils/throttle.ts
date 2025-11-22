export function throttle<T extends (...args:any[])=>void>(fn:T, ms:number): T {
  let last = 0
  let t: any
  return function(this: any, ...args:any[]) {
    const now = Date.now()
    const remain = ms - (now - last)
    if (remain <= 0) {
      last = now
      fn.apply(this, args)
    } else {
      clearTimeout(t)
      t = setTimeout(() => {
        last = Date.now()
        fn.apply(this, args)
      }, remain)
    }
  } as T
}
