import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function IconCalendar(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path stroke="none" d="M0 0h24v24H0z" />
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="4" y1="11" x2="20" y2="11" />
      <rect x="8" y="15" width="2" height="2" />
    </svg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

export function IconLoading(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 101"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
        fill="currentColor"
      />
      <path
        d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348"
        fill="currentFill"
      />
    </svg>
  );
}

export function IconFire(props: IconProps) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" {...props}>
      <path d="M750.4 308.8c-4.8-4.8-12.8-1.6-12.8 4.8 0 40 16 97.6-49.6 123.2 0 0 9.6-268.8-281.6-310.4-6.4-1.6-11.2 4.8-9.6 11.2 11.2 38.4 32 156.8-72 230.4-6.4 4.8-11.2 8-17.6 12.8-30.4-38.4-75.2-52.8-94.4-56-3.2-1.6-6.4 3.2-4.8 6.4 28.8 80-27.2 168-27.2 168h1.6c-36.8 54.4-51.2 118.4-25.6 209.6 0 0 51.2 152 243.2 188.8l-6.4-6.4s-116.8-118.4-65.6-256c28.8-73.6 89.6-113.6 89.6-113.6s-28.8 96 38.4 124.8c0 0-11.2-144 112-195.2 0 0-14.4 75.2 48 163.2 64 89.6 107.2 200 22.4 272-3.2 1.6-4.8 4.8-8 6.4 94.4-24 153.6-78.4 193.6-132.8 60.8-84.8 88-275.2-73.6-451.2z" />
    </svg>
  );
}

export function IconYouTube(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="12" fill="#d42428" />
      <path d="M10 8.8l6 3.2-6 3.2z" fill="#fff" />
    </svg>
  );
}

export function IconCopyright(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path stroke="none" d="M0 0h24v24H0z" />
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9a3.5 4 0 1 0 0 6" />
    </svg>
  );
}

export function IconMarkdown(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path stroke="none" d="M0 0h24v24H0z" />
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15v-6l2 2l2 -2v6" />
      <path d="M14 13l2 2l2 -2m-2 2v-6" />
    </svg>
  );
}
