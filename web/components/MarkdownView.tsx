import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Themed markdown renderer for weekly-review reports (GFM tables enabled). */
export default function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-tsecondary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-medium leading-tight text-tprimary">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 border-b border-edge pb-1 text-lg font-semibold text-tprimary">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 text-sm font-semibold text-tprimary">{children}</h3>
          ),
          p: ({ children }) => <p>{children}</p>,
          em: ({ children }) => <em className="text-tdim">{children}</em>,
          strong: ({ children }) => <strong className="font-semibold text-tprimary">{children}</strong>,
          a: ({ href, children }) => (
            <a href={href} className="text-accent hover:underline">{children}</a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-ai pl-3 text-tmuted">{children}</blockquote>
          ),
          code: ({ children, className }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-component px-1 py-0.5 text-xs">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border border-edge bg-component p-3 text-xs">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="text-xs font-semibold text-tdim">{children}</thead>,
          tr: ({ children }) => <tr className="border-t border-edge">{children}</tr>,
          th: ({ children }) => <th className="px-3 pb-2 text-left first:pl-0">{children}</th>,
          td: ({ children }) => <td className="num px-3 py-2 first:pl-0">{children}</td>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
