export function needsExplicitFamily(pathname: string, hasPerson: boolean): boolean {
  return /^\/(tree|people|stories|memories|archives|settings|search|relationships)(\/|$)/.test(pathname)
    || pathname === '/ancestry/connect'
    || (pathname.startsWith('/profile') && hasPerson);
}

export function resolveFamilyScope(families: { id: string }[], requested: string, required: boolean) {
  if (requested) {
    return families.some(family => family.id === requested)
      ? { id: requested, error: '' }
      : { id: '', error: 'Энэ гэр бүлийн орчинд хандах эрхгүй эсвэл гэр бүл олдсонгүй.' };
  }
  if (required && families.length === 1) return { id: families[0].id, error: '' };
  if (required) return { id: '', error: 'Гэр бүлээ сонгоно уу. Сонголт баталгаажих хүртэл хувийн мэдээллийг ачаалахгүй.' };
  return { id: families[0]?.id || '', error: '' };
}
