import { spawn, ChildProcess } from 'node:child_process'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

let pyProcess: ChildProcess | null = null
const pending = new Map<number, { resolve:(v:any)=>void, reject:(e:Error)=>void }>()
let idSeq = 1

export function initNativeBridge() {
  const py = app.isPackaged
    ? path.join(process.resourcesPath, 'py', '.venv', 'bin', process.platform === 'win32' ? 'python.exe' : 'python3')
    : path.join(app.getAppPath(), 'py', '.venv', 'bin', process.platform === 'win32' ? 'python.exe' : 'python3')

  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'py', 'native_bridge.py')
    : path.join(app.getAppPath(), 'py', 'native_bridge.py')

  if (!fs.existsSync(py)) { console.error('Python not found:', py); return }
  if (!fs.existsSync(script)) { console.error('Bridge script not found:', script); return }

  pyProcess = spawn(py, [script], { stdio: ['pipe', 'pipe', 'pipe'] })

  const rl = readline.createInterface({ input: pyProcess.stdout! })
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line)
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg)
    } catch (e) {
      console.error('Bridge parse error:', e, line)
    }
  })

  pyProcess.stderr?.on('data', d => console.error('PY:', d.toString()))
  pyProcess.on('exit', code => { console.log('Bridge exited:', code); pyProcess = null })
}

export function shutdownNativeBridge() {
  if (pyProcess) { pyProcess.kill(); pyProcess = null }
}

export function callNative(method: string, params: any): Promise<any> {
  if (!pyProcess?.stdin) return Promise.reject(new Error('Python bridge not initialized'))

  return new Promise((resolve, reject) => {
    const id = idSeq++
    pending.set(id, { resolve, reject })
    pyProcess!.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`Timeout calling native method: ${method}`))
      }
    }, 7000)
  })
}
