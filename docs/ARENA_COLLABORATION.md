# Arena + Codex: Гуулингийн хөгжүүлэлтийн урсгал

2026-10-08

## Одоогийн тохиргоо

- Arena Agent дээр `AriukagiinTuvshoo/guulingiinhan` репо холбогдсон нь харагдсан.
- Сонгосон эх branch: `codex/integration-regression-2026-10-02`.
- Тохиргоо хийх үеийн HEAD: `c6e32cf`. Дараагийн ажил бүр хамгийн сүүлийн HEAD-ээс эхэлнэ.
- Staging: <https://guulingiinhan-staging.tuvshoo0331.workers.dev>.
- Энэ тохиргоо автомат sync эсвэл GitHub write эрхийг батлахгүй. Тодорхой засварын үр дүнг commit/diff эсвэл source ZIP-ээр дамжуулж шалгана.

## Ажиллах дараалал

1. Нэг удаад тодорхой нэг хуудас эсвэл хоорондоо холбоотой цөөн засвар сонгоно. Хүлээж буй дүрслэл, үйлдлийг screenshot/тайлбараар заана.
2. Arena сонгосон branch-ийн хамгийн сүүлийн эх кодыг уншиж, дизайн болон тухайн засварын кодыг бэлдэнэ. GitHub-д commit хийх боломжгүй бол өөрчилсөн файлуудын source ZIP эсвэл patch өгнө.
3. Arena task-ийн холбоос, commit/diff, эсвэл ZIP-ийг энэ чатад өгнө. Codex түүнийг хамгийн сүүлийн integration HEAD-тэй тулгаж, өөрчлөлтийг бодит API/өгөгдөлтэй нийцүүлнэ.
4. Codex шаардлагатай шалгалт, build, responsive болон нэвтэрсэн staging QA-г гүйцэтгэнэ. Хоёр хэрэгсэл нэг файлыг зэрэг засварлахгүй.
5. Шалгасан өөрчлөлтийг integration branch руу commit/push хийнэ. PR ашигласан бол бодит diff болон шалгалтыг үзсэний дараа нэгтгэнэ. Зөвшөөрөгдсөн хүрээнд Cloudflare staging deploy хийнэ.
6. Эцсийн тайланд commit, staging холбоос, юу өөрчлөгдсөн, ямар шалгалт өнгөрсөн, үлдсэн бодит хязгаарыг өгнө.

Production deploy нь одоогийн ажлын хүрээнд орохгүй. Домэйн болон production нээлтийг тусдаа баталгаатай release үйлдлээр хийнэ.

## Arena-д ашиглах суурь заавар

Доорх зааврын `CURRENT TASK` хэсэгт тухайн удаагийн засварыг бичнэ.

```text
Work on GUULINGIINHAN, the existing private family genealogy and heritage app.

Repository: https://github.com/AriukagiinTuvshoo/guulingiinhan
Authoritative base: current HEAD of codex/integration-regression-2026-10-02.
Inspect the selected branch and latest commit before editing. Do not start from main,
old feature branches, or a standalone demo. Follow applicable repository instructions.

CURRENT TASK:
[Describe one concrete fix, the page/route, screenshot or reference, and expected behavior.]

Preserve the product name, forest green / antique gold / warm ivory visual language,
and existing navigation. Use natural Mongolian UI copy. Keep mobile controls readable,
keyboard focus visible, and page content within the viewport.

Reuse current Person/Family identities, parent-child and spouse relationships,
API authorization, consent/minor rules, and secure media delivery.
Do not replace server data with localStorage, invent real family records,
infer relationships from names, weaken auth, or expose private media.
Do not modify real staging/production data, secrets, deploy settings, or production.
Do not merge old PRs or cherry-pick old branches.

Implement only CURRENT TASK. Read package.json and use existing scripts.
For code changes, run typecheck, route regression and the production build using
the existing approved environment configuration. Run the relevant family-map,
tree-3d or heritage regression when that behavior changes. For frontend changes,
check representative mobile and desktop widths and inspect the rendered result.
For backend changes, run the relevant permission/privacy tests and repository gates.
Never claim authenticated QA without an actual authorized session.

Return:
1. Base commit and result commit, or an exact patch/source ZIP if GitHub write is unavailable.
2. Changed files and a short explanation of the result.
3. Commands actually run and their results; clearly label anything not run.
4. Before/after screenshots and any remaining issue.

Codex will review/integrate the result, verify the real application, push the
integration branch and handle the authorized Cloudflare staging deployment.
```

## Хүлээлгэн өгөх богино хэлбэр

```text
Arena task/link:
Base commit:
Result commit / patch / ZIP:
Өөрчилсөн хуудас:
Хүлээж буй үйлдэл:
Шалгасан зүйл:
Үлдсэн асуудал:
```

Нууц түлхүүр, cookie/session token болон хувийн гэр бүлийн өгөгдлийг энэ заавар,
patch эсвэл тайланд оруулахгүй. Нэвтэрсэн QA шаардлагатай үед зөвшөөрөгдсөн
browser session-ийг ашиглана.
