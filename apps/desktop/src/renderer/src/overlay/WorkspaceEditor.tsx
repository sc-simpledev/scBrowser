import { useEffect, useRef, useState } from 'react'
import { Button, Input, Switch } from '@scbrowser/ui'
import { WORKSPACE_POPUP, type WorkspaceEditorState } from '@scbrowser/shared'

export function WorkspaceEditor({ editor, x, y }: { editor: WorkspaceEditorState; x: number; y: number }) {
  const [name, setName] = useState(editor.name)
  const [focus, setFocus] = useState(editor.focus)
  const nameRef = useRef<HTMLInputElement>(null)
  const close = () => void window.scbOverlay.invoke('overlay:workspace-close')
  useEffect(() => nameRef.current?.select(), [])

  return (
    <form
      role="dialog"
      aria-label={editor.id ? 'Edit workspace' : 'New workspace'}
      className="sc-glass-strong sc-tooltip absolute flex flex-col gap-2.5 rounded-lg p-3 shadow-3"
      style={{ left: x, top: y, width: WORKSPACE_POPUP.width, height: WORKSPACE_POPUP.height }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) void window.scbOverlay.invoke('overlay:workspace-save', { id: editor.id, name, focus })
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Name
        <Input ref={nameRef} autoFocus maxLength={40} placeholder="Work, study, travel…" aria-label="Workspace name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div>Focus Mode</div>
          <div className="truncate text-xs text-text-faint">On while this workspace is open</div>
        </div>
        <Switch label="Focus Mode in this workspace" checked={focus} onChange={setFocus} />
      </div>
      <div className="mt-auto flex justify-between gap-2">
        {editor.canRemove ? (
          <Button variant="ghost" onClick={() => void window.scbOverlay.invoke('overlay:workspace-remove', editor.id!)}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {editor.id ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </form>
  )
}
