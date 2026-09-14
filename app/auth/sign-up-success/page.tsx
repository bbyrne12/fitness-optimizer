import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Thank you for signing up!
              </CardTitle>
              <CardDescription>Check your email to confirm</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Click the link in the email to confirm your account. It can
                take a minute, and it may land in spam.
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                No email after a few minutes? You may already have an account.{" "}
                <Link href="/auth/login" className="underline underline-offset-4">
                  Sign in
                </Link>{" "}
                or{" "}
                <Link href="/auth/forgot-password" className="underline underline-offset-4">
                  reset your password
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
