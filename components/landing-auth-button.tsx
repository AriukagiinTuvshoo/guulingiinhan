'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type User } from '../lib/api';

export function LandingAuthButton() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;
    api<User>('/auth/me')
      .then((me) => {
        if (active) setUser(me);
      })
      .catch(() => {
        if (active) setUser(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (user) {
    return (
      <Link href="/tree" className="luxury-landing__signin-pill">
        {user.display_name ? `${user.display_name} · Мод →` : 'Удмын мод →'}
      </Link>
    );
  }

  return (
    <Link href="/login" className="luxury-landing__signin-pill">
      Нэвтрэх
    </Link>
  );
}
