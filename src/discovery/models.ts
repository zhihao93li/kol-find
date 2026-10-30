export type Platform = "instagram" | "youtube" | "tiktok";
export const PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok"];

/** Where an email was found, from most to least trustworthy. */
export type EmailSource = "platform_field" | "bio" | "link_page" | "youtube_hidden";

export interface RecentPost {
  time: string; // ISO
  likes: number | null;
  comments: number | null;
  views: number | null;
  pinned?: boolean;
}

/** One creator as the discovery pipeline sees it. */
export class Creator {
  profileUrl = "";
  name = "";
  followers: number | null = null;
  isBusiness: boolean | null = null;
  isPrivate: boolean | null = null;
  bio = "";
  externalUrl = "";
  discoveredBy = ""; // e.g. "related", "search:新秘", "input"
  // Activity, from whatever the actors already return; null when they don't say.
  postsCount: number | null = null;
  lastPostAt = ""; // ISO time of the newest post seen
  avgLikes: number | null = null; // over the recent posts seen
  avgComments: number | null = null;
  avgViews: number | null = null; // recent posts, or for YouTube the channel's lifetime views per video
  email = "";
  emailSource: EmailSource | "" = "";
  /** Every address found, with the source it was first seen in. */
  emails: { email: string; source: EmailSource }[] = [];
  note = "";

  constructor(
    public platform: Platform,
    public handle: string,
    init: Partial<Omit<Creator, "platform" | "handle" | "emails" | "addEmail" | "key" | "allEmails" | "setPosts">> = {},
  ) {
    Object.assign(this, init);
  }

  get key(): string {
    return `${this.platform}:${normalizeHandle(this.handle)}`;
  }

  get allEmails(): string[] {
    return this.emails.map((e) => e.email);
  }

  /** Activity from a few recent posts. Pinned ones are left out: they sit on top however old they are. */
  setPosts(posts: RecentPost[]): void {
    const recent = posts.filter((p) => !p.pinned);
    const times = recent.map((p) => p.time).filter(Boolean).sort();
    if (times.length) this.lastPostAt = times[times.length - 1];
    const avg = (pick: (p: RecentPost) => number | null) => {
      // Hidden counts come back as -1 or not at all.
      const xs = recent.map(pick).filter((x): x is number => x != null && x >= 0);
      return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    };
    this.avgLikes = avg((p) => p.likes) ?? this.avgLikes;
    this.avgComments = avg((p) => p.comments) ?? this.avgComments;
    this.avgViews = avg((p) => p.views) ?? this.avgViews;
  }

  addEmail(email: string, source: EmailSource): void {
    email = email.trim();
    if (!email) return;
    if (!this.emails.some((e) => e.email.toLowerCase() === email.toLowerCase())) {
      this.emails.push({ email, source });
    }
    if (!this.email) {
      this.email = email;
      this.emailSource = source;
    }
  }
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

/** "channel/<id>" for a youtube.com/channel/<id> link, else "". Channel ids are matched case-insensitively. */
export function channelKey(url: string): string {
  const m = (url || "").match(/youtube\.com\/channel\/([\w-]+)/i);
  return m ? `channel/${m[1].toLowerCase()}` : "";
}
