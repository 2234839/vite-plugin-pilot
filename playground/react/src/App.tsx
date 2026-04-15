import { useState } from 'react'

export default function App() {
  const logInfo = () => console.log('这是一条 info 日志', { timestamp: Date.now(), foo: 'bar' })
  const logWarn = () => console.warn('这是一条 warning 日志', 'deprecated API usage')
  const logError = () => console.error('这是一条 error 日志', new Error('测试错误'))
  const throwError = () => { throw new Error('手动抛出的异常') }
  const rejectPromise = () => { Promise.reject(new Error('Promise 被拒绝了')) }

  return (
    <div className="app">
      <h1>Vite Plugin Pilot - React Playground</h1>
      <p className="subtitle">Alt+Click 任意元素可选中并查看信息</p>

      <section className="card">
        <h2>测试功能</h2>
        <div className="btn-group">
          <button onClick={logInfo}>console.log</button>
          <button onClick={logWarn}>console.warn</button>
          <button onClick={logError}>console.error</button>
          <button onClick={throwError}>抛出异常</button>
          <button onClick={rejectPromise}>Promise 拒绝</button>
        </div>
      </section>

      <section className="card">
        <h2>组件测试</h2>
        <UserCard name="张三" role="前端工程师" />
        <UserCard name="李四" role="后端工程师" />
      </section>

      <section className="card">
        <h2>列表数据</h2>
        <ul>
          {[
            { id: 1, name: '任务 A', status: '进行中' },
            { id: 2, name: '任务 B', status: '已完成' },
            { id: 3, name: '任务 C', status: '待开始' },
          ].map(item => (
            <li key={item.id}>{item.name} - {item.status}</li>
          ))}
        </ul>
      </section>

      <FormSection />
    </div>
  )
}

function UserCard({ name, role }: { name: string; role: string }) {
  return (
    <div className="user-card">
      <div className="avatar">{name[0]}</div>
      <div className="info">
        <div className="name">{name}</div>
        <div className="role">{role}</div>
      </div>
    </div>
  )
}

/** React 响应式表单测试区域 */
function FormSection() {
  const [name, setName] = useState('')
  const [role, setRole] = useState('dev')
  const [agreed, setAgreed] = useState(false)

  return (
    <section className="card">
      <h2>表单（useState）</h2>
      <div className="form-row">
        <label>姓名</label>
        <input placeholder="请输入姓名" value={name} onChange={e => setName(e.target.value)} />
        {name && <span className="form-preview">姓名: {name}</span>}
      </div>
      <div className="form-row">
        <label>角色</label>
        <select value={role} onChange={e => setRole(e.target.value)}>
          <option value="dev">开发者</option>
          <option value="designer">设计师</option>
          <option value="pm">产品经理</option>
        </select>
        {role && <span className="form-preview">角色: {role}</span>}
      </div>
      <div className="form-row">
        <label><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} /> 同意条款</label>
        {agreed && <span className="form-preview">已同意</span>}
      </div>
    </section>
  )
}
