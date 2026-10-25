import { approveDeviceAuthorization, denyDeviceAuthorization } from "@/lib/server/device";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import deepmerge from "deepmerge";
import { AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import de from "../../locales/de.json";
import en from "../../locales/en.json";
import { ConsentScreen } from "./consent";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/server/device", () => ({ approveDeviceAuthorization: vi.fn(), denyDeviceAuthorization: vi.fn() }));

function renderConsent(
  props: Partial<ComponentProps<typeof ConsentScreen>> = {},
  messages: AbstractIntlMessages = en,
  locale = "en",
) {
  const onError = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={deepmerge.all([en, messages])} onError={onError}>
      <ConsentScreen
        scope={["openid", "profile", "email", "offline_access"]}
        userCode="ABCD-1234"
        sessionId="session-1"
        organization="org-1"
        appName="modernpath-cli"
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onError };
}

describe("ConsentScreen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(approveDeviceAuthorization).mockResolvedValue({ redirect: "/signedin?requestId=device_ABCD-1234" });
    vi.mocked(denyDeviceAuthorization).mockResolvedValue({ details: {} });
  });
  afterEach(cleanup);

  test.each([
    ["en", en],
    ["de", de],
  ])("renders translated actions and permissions in %s", (locale, messages) => {
    const { onError } = renderConsent({}, messages, locale);

    expect(screen.getByRole("button", { name: messages.device.request.deny })).toBeVisible();
    expect(screen.getByRole("button", { name: messages.device.request.submit })).toBeVisible();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      messages.device.scope.openid,
      messages.device.scope.profile,
      messages.device.scope.email,
      messages.device.scope.offline_access,
    ]);
    expect(screen.getByText(en.device.request.usercode)).toBeVisible();
    expect(onError).not.toHaveBeenCalled();
  });

  test("keeps unknown requested scopes visible without missing-translation errors", () => {
    const unknown = [
      "urn:zitadel:iam:org:project:id:123456789:aud",
      "api.example.com/permissions/read",
      "<script>alert('permission')</script>",
    ];
    const { onError } = renderConsent({ scope: ["openid", ...unknown] });

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([en.device.scope.openid, ...unknown]);
    expect(document.querySelector("script")).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  test.each([undefined, [], ["", "  "]])("shows identity access for empty scopes: %j", (scope) => {
    const { onError } = renderConsent({ scope });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent(en.device.scope.openid);
    expect(onError).not.toHaveBeenCalled();
  });

  test("uses the scope name when its custom translation is blank", () => {
    renderConsent({ scope: ["email"] }, { ...en, device: { ...en.device, scope: { ...en.device.scope, email: "  " } } });

    expect(screen.getByRole("listitem")).toHaveTextContent("email");
  });

  test("uses a configured description for a custom scope", () => {
    renderConsent(
      { scope: ["urn:example:documents:read"] },
      {
        ...en,
        device: {
          ...en.device,
          scope: { ...en.device.scope, "urn:example:documents:read": "Read your documents." },
        },
      },
    );

    expect(screen.getByRole("listitem")).toHaveTextContent("Read your documents.");
  });

  test("shows the user code so it can be compared with the device", () => {
    renderConsent();
    expect(screen.getByTestId("user-code")).toHaveTextContent("ABCD-1234");
  });

  test("approves the device authorization and follows the returned redirect", async () => {
    renderConsent();
    fireEvent.click(screen.getByRole("button", { name: en.device.request.submit }));
    await waitFor(() =>
      expect(approveDeviceAuthorization).toHaveBeenCalledExactlyOnceWith({
        userCode: "ABCD-1234",
        sessionId: "session-1",
        organization: "org-1",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signedin?requestId=device_ABCD-1234"));
    expect(denyDeviceAuthorization).not.toHaveBeenCalled();
  });

  test("denies the device authorization and returns to the code entry page", async () => {
    renderConsent();
    fireEvent.click(screen.getByRole("button", { name: en.device.request.deny }));
    await waitFor(() =>
      expect(denyDeviceAuthorization).toHaveBeenCalledExactlyOnceWith({
        userCode: "ABCD-1234",
        sessionId: "session-1",
        organization: "org-1",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/device"));
    expect(approveDeviceAuthorization).not.toHaveBeenCalled();
  });
});
