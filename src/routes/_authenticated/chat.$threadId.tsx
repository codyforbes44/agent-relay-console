import { createFileRoute } from "@tanstack/react-router";

import { Workspace } from "./chat.index";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  head: () => ({
    meta: [
      { title: "Conversation — Relay Agent Workspace" },
      {
        name: "description",
        content: "Review the streaming agent transcript, tool-call timeline, and approvals for this run.",
      },
      { property: "og:title", content: "Conversation — Relay Agent Workspace" },
      { property: "og:description", content: "Agent transcript with a full tool-call timeline." },
    ],
  }),
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  return <Workspace key={threadId} threadId={threadId} />;
}
