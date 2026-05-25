export type AppIconName =
  | "home"
  | "accounts"
  | "style"
  | "overview"
  | "queue"
  | "trends"
  | "settings"
  | "refresh"
  | "send"
  | "folder"
  | "spark"
  | "logout"
  | "user";

export function AppIcon({ name, className = "h-5 w-5" }: { name: AppIconName; className?: string }) {
  const commonProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return (
        <svg {...commonProps}>
          <path d="M4 7.5h16M4 12h16M4 16.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...commonProps}>
          <path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20c.6-3.2 2.3-5 5-5s4.4 1.8 5 5M17 8h4M17 13h4M17 18h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "style":
      return (
        <svg {...commonProps}>
          <path d="M12 3l1.55 5.05L18.6 9.6l-5.05 1.55L12 16.2l-1.55-5.05L5.4 9.6l5.05-1.55L12 3Z" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18 14.5l.85 2.65L21.5 18l-2.65.85L18 21.5l-.85-2.65L14.5 18l2.65-.85L18 14.5Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "overview":
      return (
        <svg {...commonProps}>
          <path d="M5 5h6v6H5V5ZM13 5h6v6h-6V5ZM5 13h6v6H5v-6ZM13 13h6v6h-6v-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
    case "queue":
      return (
        <svg {...commonProps}>
          <path d="M7 7h10M7 12h10M7 17h6M4 7h.01M4 12h.01M4 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "trends":
      return (
        <svg {...commonProps}>
          <path d="m4 16 4-4 3 3 6-7M15 8h2v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...commonProps}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 12a7.2 7.2 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L14.5 3h-5l-.3 3.1a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.2 7.2 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.3 3.1h5l.3-3.1a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...commonProps}>
          <path d="M20 12a8 8 0 1 1-2.3-5.7M20 5v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "send":
      return (
        <svg {...commonProps}>
          <path d="m4 12 16-8-5 16-3-7-8-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "folder":
      return (
        <svg {...commonProps}>
          <path d="M4 7.8A2.8 2.8 0 0 1 6.8 5h3l2 2h5.4A2.8 2.8 0 0 1 20 9.8v6.4a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 16.2V7.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
    case "spark":
      return (
        <svg {...commonProps}>
          <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3ZM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "logout":
      return (
        <svg {...commonProps}>
          <path d="M10 6H6.8A2.8 2.8 0 0 0 4 8.8v6.4A2.8 2.8 0 0 0 6.8 18H10M15 8l4 4-4 4M19 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "user":
      return (
        <svg {...commonProps}>
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20c.9-4.2 3.4-6.3 7.5-6.3s6.6 2.1 7.5 6.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}
