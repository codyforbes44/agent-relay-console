/** Services a workspace can store its own API key for. Browser-safe. */
export type CredentialService = {
  id: string;
  name: string;
  help: string;
  helpUrl: string;
  configFields: { key: string; label: string; options?: { value: string; label: string }[] }[];
};

export const CREDENTIAL_SERVICES: CredentialService[] = [
  {
    id: "make",
    name: "Make.com",
    help: "In Make, open your profile → API access → Add token. Pick the region shown in your Make address (e.g. us1.make.com).",
    helpUrl: "https://www.make.com/en/api-documentation",
    configFields: [
      {
        key: "zone",
        label: "Region",
        options: [
          { value: "us1", label: "us1.make.com" },
          { value: "us2", label: "us2.make.com" },
          { value: "eu1", label: "eu1.make.com" },
          { value: "eu2", label: "eu2.make.com" },
        ],
      },
    ],
  },
  {
    id: "custom",
    name: "Other service",
    help: "Any other API key your workspace wants to keep encrypted here.",
    helpUrl: "",
    configFields: [],
  },
];
