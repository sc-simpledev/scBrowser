import { useEffect, useRef, useState } from 'react'
import { Button, Input, Select } from '@scbrowser/ui'
import { BOOKMARK_POPUP, type BookmarkEditorState } from '@scbrowser/shared'

/** Name, group and, from the toolbar, the address of one bookmark. */
export function BookmarkEditor({ editor, x, y }: { editor: BookmarkEditorState; x: number; y: number }) {
  const [title, setTitle] = useState(editor.title)
  const [url, setUrl] = useState(editor.url)
  const [groupId, setGroupId] = useState(editor.groupId)
  const [problem, setProblem] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const close = () => void window.scbOverlay.invoke('overlay:bookmark-close')

  useEffect(() => {
    nameRef.current?.select()
  }, [])

  return (
    <form
      role="dialog"
      aria-label="Edit bookmark"
      className="absolute flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-2"
      style={{ left: x, top: y, width: BOOKMARK_POPUP.width }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        void window.scbOverlay.invoke('overlay:bookmark-save', { id: editor.id, title, url, groupId }).then(setProblem)
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Name
        <Input ref={nameRef} autoFocus aria-label="Bookmark name" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {editor.editUrl && (
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Address
          <Input aria-label="Bookmark address" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Group
        <Select aria-label="Bookmark group" value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">None</option>
          {editor.groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      </label>
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
      <div className="mt-1 flex justify-between gap-2">
        <Button variant="ghost" onClick={() => void window.scbOverlay.invoke('overlay:bookmark-remove', editor.id)}>
          Remove
        </Button>
        <div className="flex gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </div>
    </form>
  )
}
