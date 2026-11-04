/*################################(ENTRY WINDOW)################################*/
// /*@SCREENS@*/  (Genesis Pro Builder · InSpatial Kit showcase template)
import { Image } from "@inspatial/kit/media";

/*@CONFIG@*/
const artFor = (name: string) => ShelfArt[name] ?? ShelfArt[Object.keys(ShelfArt).find((k) => k !== "__hero" && name.toLowerCase().includes(k.toLowerCase().split(" ")[0])) ?? ""] ?? "";
const norm = (r: Record<string, unknown>): Row => ({ id: String(r.id), name: String(r[F.name] ?? ""), stock: F.stock ? Number(r[F.stock] ?? 0) : 0, unit: F.unit ? String(r[F.unit] ?? "") : "" });

type Row = { id: string; name: string; stock: number; unit: string };
// InSpatial Cloud entries API: product rows live in Cloud; every tap writes back through updateEntry.
const rows = createState<Row[]>([]);
type OrderRow = { id: string; product: string; quantity: number; date: string };
const recent = createState<OrderRow[]>([]);
const busy = createState("");
const toast = createState("");
const load = async () => {
  const r = await cloud.api.entry.getEntryList<Record<string, unknown>>(F.entry, { orderBy: "createdAt", order: "asc" });
  rows.set(r.rows.map(norm));
  if (O) {
    const o = await cloud.api.entry.getEntryList<Record<string, unknown>>(O.entry, { orderBy: "createdAt", order: "desc", limit: 4 });
    recent.set(o.rows.map((x) => ({ id: String(x.id), product: String(x[O.product] ?? ""), quantity: Number(O.qty ? x[O.qty] ?? 0 : 0), date: String(O.date ? x[O.date] ?? "" : "") })));
  }
};
const boot = async () => {
  try {
    await load();
    if (!rows.peek().length) {
      for (const s of SEED) await cloud.api.entry.createEntry(F.entry, s.raw);
      await load();
    }
  } catch (e) { console.error("[shelf] cloud load failed", String(e)); }
};
boot();

const setStock = async (row: Row, next: number) => {
  busy.set(row.id);
  rows.set(rows.peek().map((r) => (r.id === row.id ? { ...r, stock: Math.max(0, next) } : r)));
  try {
    if (F.stock) await cloud.api.entry.updateEntry(F.entry, row.id, { [F.stock]: Math.max(0, next) });
  } finally {
    await load();
    busy.set("");
  }
};
const reorder = async (row: Row) => {
  const qty = Math.max(1, PAR - Number(row.stock));
  if (O) await cloud.api.entry.createEntry(O.entry, { [O.product]: row.name, ...(O.qty ? { [O.qty]: qty } : {}), ...(O.date ? { [O.date]: new Date().toISOString().slice(0, 10) } : {}) });
  await setStock(row, Number(row.stock) + qty);
  toast.set(`${TEXT.ordered} ${qty} × ${row.name} · back to ${PAR}`);
  setTimeout(() => toast.set(""), 3200);
};

const total = $(() => rows.get().reduce((a: number, r: { stock: number }) => a + Number(r.stock || 0), 0));
const lowCount = $(() => rows.get().filter((r: { stock: number }) => Number(r.stock) <= LOW).length);

<ErrorBoundary>
  <Slot className={EntryStyle.page.getStyle()}>
  <Slot className={EntryStyle.root.getStyle()}>
    <Slot className={EntryStyle.hero.getStyle()}>
      <Image src={ShelfArt.__hero} alt={TEXT.title} className={EntryStyle.heroImg.getStyle()} />
      <Slot className={EntryStyle.heroShade.getStyle()} />
      <Slot className={EntryStyle.heroBody.getStyle()}>
        <Slot className={EntryStyle.eyebrow.getStyle()}>{TEXT.eyebrow}</Slot>
        <Slot className={EntryStyle.title.getStyle()}>{TEXT.title}</Slot>
        <Slot className={EntryStyle.subtitle.getStyle()}>{TEXT.subtitle}</Slot>
        <Slot className={EntryStyle.stats.getStyle()}>
          <Slot className={EntryStyle.stat.getStyle()}><Slot className={EntryStyle.statNum.getStyle()}>{$(() => String(rows.get().length))}</Slot><Slot className={EntryStyle.statLabel.getStyle()}>{TEXT.items}</Slot></Slot>
          {F.stock ? (
            <Fragment>
          <Slot className={EntryStyle.stat.getStyle()}><Slot className={EntryStyle.statNum.getStyle()}>{total}</Slot><Slot className={EntryStyle.statLabel.getStyle()}>{TEXT.units}</Slot></Slot>
          <Slot className={$(() => (lowCount.get() > 0 ? EntryStyle.statWarn.getStyle() : EntryStyle.stat.getStyle()))}><Slot className={EntryStyle.statNum.getStyle()}>{lowCount}</Slot><Slot className={EntryStyle.statLabel.getStyle()}>{TEXT.low}</Slot></Slot>
            </Fragment>
          ) : null}
        </Slot>
      </Slot>
    </Slot>

    <Slot className={EntryStyle.sectionHead.getStyle()}>
      <Slot className={EntryStyle.sectionTitle.getStyle()}>{TEXT.section}</Slot>
      <Slot className={EntryStyle.sectionMeta.getStyle()}>{F.stock ? `Par level ${PAR} · low at ${LOW}` : `${TEXT.count}`}</Slot>
    </Slot>

    <Slot className={EntryStyle.grid.getStyle()}>
      <List each={rows}>
        {(row: Row) => {
          const n = Number(row.stock);
          const low = !!F.stock && n <= LOW;
          const seed = SEED.find((s) => s.name === row.name);
          return (
            <Slot className={EntryStyle.card.getStyle()} data-low={low ? "1" : "0"}>
              <Slot className={EntryStyle.media.getStyle()}>
                {artFor(row.name) ? <Image src={artFor(row.name)} alt={row.name} className={EntryStyle.mediaImg.getStyle()} /> : <Slot className={EntryStyle.mono.getStyle()}>{row.name.slice(0, 1)}</Slot>}
                {F.stock ? <Slot className={low ? EntryStyle.badgeLow.getStyle() : EntryStyle.badgeOk.getStyle()}>{low ? TEXT.lowBadge : TEXT.okBadge}</Slot> : null}
              </Slot>
              <Slot className={EntryStyle.cardBody.getStyle()}>
                <Slot className={EntryStyle.name.getStyle()}>{row.name}</Slot>
                <Slot className={EntryStyle.detail.getStyle()}>{seed?.detail ?? row.unit}</Slot>
                {F.stock ? (
                  <Fragment>
                <Slot className={EntryStyle.countRow.getStyle()}>
                  <Slot className={EntryStyle.count.getStyle()}>{String(n)}</Slot>
                  <Slot className={EntryStyle.unit.getStyle()}>{`${row.unit}${n === 1 ? "" : "s"} / ${PAR}`}</Slot>
                </Slot>
                <Slot className={EntryStyle.track.getStyle()}>
                  <Slot className={low ? EntryStyle.fillLow.getStyle() : EntryStyle.fill.getStyle()} style={{ width: `${Math.min(100, (n / PAR) * 100)}%` }} />
                </Slot>
                <Slot className={EntryStyle.actions.getStyle()}>
                  <Button className={EntryStyle.step.getStyle()} aria-label={`Use one ${row.unit}`} on:tap={() => setStock(row, n - 1)}>−</Button>
                  <Button className={EntryStyle.step.getStyle()} aria-label={`Add one ${row.unit}`} on:tap={() => setStock(row, n + 1)}>+</Button>
                  <Button className={low ? EntryStyle.orderHot.getStyle() : EntryStyle.order.getStyle()} on:tap={() => reorder(row)}>{low ? TEXT.orderLow : TEXT.orderOk}</Button>
                </Slot>
                  </Fragment>
                ) : null}
              </Slot>
            </Slot>
          );
        }}
      </List>
    </Slot>

    <Show when={$(() => recent.get().length > 0)}>
      <Slot className={EntryStyle.orders.getStyle()}>
        <Slot className={EntryStyle.sectionTitle.getStyle()}>Recent orders</Slot>
        <Slot className={EntryStyle.orderList.getStyle()}>
          <List each={recent}>
            {(o: OrderRow) => (
              <Slot className={EntryStyle.orderChip.getStyle()}>
                {artFor(o.product) ? <Image src={artFor(o.product)} alt="" className={EntryStyle.orderThumb.getStyle()} /> : <Slot className={EntryStyle.orderMono.getStyle()}>{o.product.slice(0, 1)}</Slot>}
                <Slot className={EntryStyle.orderText.getStyle()}>
                  <Slot className={EntryStyle.orderName.getStyle()}>{`${o.quantity} × ${o.product}`}</Slot>
                  <Slot className={EntryStyle.orderMeta.getStyle()}>{`Saved to InSpatial Cloud · ${o.date}`}</Slot>
                </Slot>
              </Slot>
            )}
          </List>
        </Slot>
      </Slot>
    </Show>

    <Slot className={EntryStyle.footer.getStyle()}>Made with Genesis Pro Builder · InSpatial Kit + InSpatial Cloud</Slot>
    <Show when={$(() => toast.get() !== "")}>
      <Slot className={EntryStyle.toast.getStyle()}>{toast}</Slot>
    </Show>
  </Slot>
  </Slot>
</ErrorBoundary>;
