"use client";
import { useEffect, useState, useRef } from "react";
import { Search, UserPlus, Check, X, Users } from "lucide-react";
import { api, command } from "@/lib/client";
import { schoolClasses } from "@/lib/profile-fields";
import { roles, type Role } from "@/lib/types";
import { Avatar, Busy, Empty, Modal } from "./ui";
type Person = { id: string; name: string; class_name: string | null; bio: string; role: Role; requested_role: string; avatar_id: string | null; relationship: "none" | "incoming" | "outgoing" | "friends" };
export function People() {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [cls, setCls] = useState(""), [kind, setKind] = useState("all");
  const [items,setItems] = useState<Person[]>([]), [more,setMore] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [version,setVersion] = useState(0), [pending,setPending] = useState(false), [selected,setSelected] = useState<Person|null>(null);
  const generation = useRef(0), actionLock = useRef(false);
  useEffect(() => {const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer);},[query]);
  function url(offset: number) {return "people?" + new URLSearchParams({q:search,class:cls,kind,offset:String(offset)});}
  useEffect(() => {
    const current = ++generation.current;
    let active=true;setBusy(true);setError("");setItems([]);setMore(false);
    api<{items:Person[];more:boolean}>(url(0)).then(v=>{if(active){setItems(v.items);setMore(v.more);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;if(generation.current===current)generation.current++;};
  },[search,cls,kind,version]);
  async function act(person:Person, operation:string) {
    if(actionLock.current)return;actionLock.current=true;setPending(true);setError("");
    try {await command("friend",{id:person.id,operation});setSelected(null);setVersion(v=>v+1);}catch(e){setError((e as Error).message);}finally{actionLock.current=false;setPending(false);}
  }
  function actions(p:Person) {
    return <div className="person-actions">{p.relationship === "none" ? <button className="button secondary" disabled={pending} onClick={()=>act(p,"request")}><UserPlus size={17}/>Добавить</button> : p.relationship === "incoming" ? <><button className="button" disabled={pending} onClick={()=>act(p,"accept")}><Check size={17}/>Принять</button><button className="icon-button" aria-label="Отклонить заявку" disabled={pending} onClick={()=>act(p,"remove")}><X size={18}/></button></> : <button className="text-button" disabled={pending} onClick={()=>act(p,"remove")}>{p.relationship === "friends" ? "Удалить из друзей" : "Отменить заявку"}</button>}</div>;
  }
  return <section className="people-section">
    <div className="page-title"><div><h1>Люди</h1><p className="muted">Найди своих в школе.</p></div><Users className="title-icon"/></div>
    <div className="people-filters"><label className="search-field"><span className="visually-hidden">Имя или фамилия</span><Search size={19}/><input placeholder="Имя или фамилия" value={query} onChange={e=>setQuery(e.target.value)} maxLength={80}/></label><label><span className="visually-hidden">Класс</span><select value={cls} onChange={e=>setCls(e.target.value)}><option value="">Все классы</option>{schoolClasses.map(c=><option key={c}>{c}</option>)}</select></label></div>
    <div className="chips">{[["all","Все"],["teachers","Учителя"],["friends","Друзья"],["incoming","Входящие"],["outgoing","Отправленные"]].map(([key,label])=><button key={key} className={kind===key?"selected":""} aria-pressed={kind===key} onClick={()=>setKind(key)}>{label}</button>)}</div>
    {error && <p className="error" role="alert">{error}<button className="text-button" onClick={()=>setVersion(v=>v+1)}>Повторить</button></p>}
    <div className="people-list">{items.map(p=><article className="person-card" key={p.id}><button className="person-identity" onClick={()=>setSelected(p)}><Avatar name={p.name} id={p.avatar_id}/><span><strong>{p.name}</strong><small>{p.class_name ? p.class_name+" · " : ""}{roles[p.role]}{p.relationship==="friends"?" · В друзьях":""}</small></span></button>{p.bio && <p className="person-bio">{p.bio}</p>}{actions(p)}</article>)}</div>
    {busy && <Busy/>}{!busy&&!error&&!items.length&&<Empty title="Пока никого">Попробуй другое имя или класс.</Empty>}
    {more&&<button className="button secondary wide" disabled={busy} onClick={async()=>{const current=generation.current;setBusy(true);try{const v=await api<{items:Person[];more:boolean}>(url(items.length));if(current===generation.current){setItems(old=>[...old,...v.items.filter(p=>!old.some(o=>o.id===p.id))]);setMore(v.more);}}catch(e){if(current===generation.current)setError((e as Error).message);}finally{if(current===generation.current)setBusy(false);}}}>Показать ещё</button>}
    {selected&&<Modal title="Профиль" close={()=>setSelected(null)} busy={pending}><div className="member-profile"><Avatar name={selected.name} id={selected.avatar_id} size="large"/><h2>{selected.name}</h2><p className="muted">{selected.class_name} · {roles[selected.role]}</p><p className="preserve">{selected.bio || "Пока без описания"}</p>{actions(selected)}</div>{error&&<p className="error" role="alert">{error}</p>}</Modal>}
  </section>;
}
