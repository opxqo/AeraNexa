"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AVATARS, UserAvatar } from "@/components/aera/avatars";
import { DataTable, type Column } from "@/components/aera/data-table";
import { Page, PageHeader, SettingRow, Section } from "@/components/aera/page-layout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SESSIONS } from "@/lib/demo/cursor-mock";
import { useCursorState } from "./state";

type Session = (typeof SESSIONS)[number];

export function SettingsPage() {
  const { first, last, setName, avatar, setAvatar } = useCursorState();
  const [draft, setDraft] = useState({ first, last });
  const [digest, setDigest] = useState("weekly");
  const [alerts, setAlerts] = useState(true);
  const [product, setProduct] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [sessions, setSessions] = useState(SESSIONS);
  const [remove, setRemove] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const dirty = draft.first !== first || draft.last !== last;

  const columns: Column<Session>[] = [
    {
      key: "device",
      header: "Device",
      cell: (row) => (
        <span className="flex items-center gap-2">
          {row.device}
          {row.current && <Badge variant="secondary">This device</Badge>}
        </span>
      ),
    },
    { key: "place", header: "Location", hideBelow: "sm", cell: (row) => row.place },
    { key: "seen", header: "Last seen", hideBelow: "md", cell: (row) => row.seen },
    {
      key: "action",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (row) =>
        row.current ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSessions((list) => list.filter((item) => item.id !== row.id));
              toast.success("Signed out of that device.");
            }}
          >
            Sign out
          </Button>
        ),
    },
  ];

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Settings" description="Your profile, notifications, privacy and sessions." />

      <Section label="Profile">
        <Card>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                setName(draft.first.trim(), draft.last.trim());
                toast.success("Profile saved");
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel>Avatar</FieldLabel>
                  <ToggleGroup value={[avatar]} onValueChange={(value) => value[0] && setAvatar(value[0] as typeof avatar)} spacing={2} className="flex-wrap" aria-label="Avatar">
                    {AVATARS.map((item) => (
                      <ToggleGroupItem key={item.id} value={item.id} aria-label={item.label} className="size-11 rounded-full p-0.5 data-[pressed]:bg-transparent data-[pressed]:ring-2 data-[pressed]:ring-foreground data-[pressed]:ring-offset-2 data-[pressed]:ring-offset-card aria-pressed:bg-transparent">
                        <UserAvatar avatar={item.id} size="lg" className="size-full" />
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription>Pick one of the default avatars.</FieldDescription>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="first-name">First name</FieldLabel>
                    <Input id="first-name" value={draft.first} onChange={(event) => setDraft({ ...draft, first: event.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="last-name">Last name</FieldLabel>
                    <Input id="last-name" value={draft.last} onChange={(event) => setDraft({ ...draft, last: event.target.value })} />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input id="email" value="alex.smith@example.com" disabled readOnly />
                  <FieldDescription>Your email is managed by your sign-in provider.</FieldDescription>
                </Field>
              </FieldGroup>
              <Button type="submit" disabled={!dirty}>
                Save changes
              </Button>
            </form>
          </CardContent>
        </Card>
      </Section>

      <Section label="Notifications">
        <Card>
          <CardContent className="space-y-5">
            <SettingRow title="Usage alerts" description="Email me when I reach 80% of my included usage.">
              <Switch checked={alerts} onCheckedChange={setAlerts} aria-label="Usage alerts" />
            </SettingRow>
            <Separator />
            <SettingRow title="Product updates" description="News about new features and models.">
              <Switch checked={product} onCheckedChange={setProduct} aria-label="Product updates" />
            </SettingRow>
            <Separator />
            <SettingRow title="Usage digest" description="A summary of your usage by email.">
              <ToggleGroup variant="outline" value={[digest]} onValueChange={(value) => value[0] && setDigest(value[0])} aria-label="Usage digest">
                <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
                <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
                <ToggleGroupItem value="never">Never</ToggleGroupItem>
              </ToggleGroup>
            </SettingRow>
          </CardContent>
        </Card>
      </Section>

      <Section label="Privacy">
        <Card>
          <CardContent>
            <SettingRow title="Privacy mode" description={privacy ? "On: your code is never stored or used for training." : "Off: code may be used to improve the product."}>
              <PrivacyDialog value={privacy} onSave={setPrivacy} />
            </SettingRow>
          </CardContent>
        </Card>
      </Section>

      <Section label="Sessions" description="Devices where you are signed in.">
        <DataTable columns={columns} rows={sessions} rowKey={(row) => row.id} />
      </Section>

      <Section label="Danger zone">
        <Card className="ring-destructive/30">
          <CardContent>
            <SettingRow title="Delete account" description="Permanently delete your account and all of its data. This cannot be undone.">
              <Button variant="destructive" onClick={() => setRemove(true)}>
                Delete account
              </Button>
            </SettingRow>
          </CardContent>
        </Card>
      </Section>

      <AlertDialog
        open={remove}
        onOpenChange={(open) => {
          setRemove(open);
          if (!open) setConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This would remove your profile, usage history and integrations. Type <strong className="text-foreground">delete</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input aria-label="Type delete to confirm" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="delete" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={confirmText !== "delete"} onClick={() => toast("Your account would be deleted here. This is a demo.")}>
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function PrivacyDialog({ value, onSave }: { value: boolean; onSave: (value: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(value);
      }}
    >
      <Button variant="outline" onClick={() => setOpen(true)}>
        Manage
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Privacy mode</DialogTitle>
          <DialogDescription>Choose what happens to the code you work on.</DialogDescription>
        </DialogHeader>
        <Field orientation="horizontal">
          <Checkbox id="privacy-mode" checked={draft} onCheckedChange={(checked) => setDraft(checked === true)} />
          <FieldLabel htmlFor="privacy-mode" className="font-normal">
            Never store my code or use it for training
          </FieldLabel>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            onClick={() => {
              onSave(draft);
              setOpen(false);
              toast.success("Privacy settings saved");
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
