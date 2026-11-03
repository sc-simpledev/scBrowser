import { useEffect, useRef, useState } from 'react'
import { Button, Input, Select } from '@scbrowser/ui'
import { BOOKMARK_POPUP, folderTree, type BookmarkEditorState } from '@scbrowser/shared'

/** Name, folder and, from the toolbar, the address of one bookmark. */
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
      className="sc-glass-strong sc-tooltip absolute flex flex-col gap-2 rounded-lg p-3 shadow-3"
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
        Folder
        <Select aria-label="Bookmark folder" value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">None</option>
          {folderTree(editor.groups).map(({ group, path }) => (
            <option key={group.id} value={group.id}>
              {path}
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
