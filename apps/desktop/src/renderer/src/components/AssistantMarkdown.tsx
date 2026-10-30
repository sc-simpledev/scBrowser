import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isHttpUrl } from '@scbrowser/shared'

/**
 * Replies can repeat text from web pages, so they're treated as untrusted. Raw HTML is
 * never rendered, and images are dropped because loading one could leak data to its URL.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="sc-prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) =>
            href && isHttpUrl(href) ? (
              <button
                type="button"
                title={href}
                className="sc-link"
                onClick={() => void window.scb.invoke('tabs:open-in-background', href)}
              >
                {children}
              </button>
            ) : (
              <span>{children}</span>
            )
        }}
      >
        {text}
      </Markdown>
    </div>
  )
})
