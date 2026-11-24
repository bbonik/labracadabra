/**
 * One consistent line-icon set (Lucide, ISC licence) instead of emoji: emoji render differently on every OS and
 * look unprofessional next to data. Panels keep their emoji in the catalog for other uses; the UI maps panel ids here.
 */
import type { ComponentType } from "preact";
import {
  Activity, Atom, Bean, Bone, ChartLine, CircleDollarSign, ClipboardList, Droplet, Droplets, Ear, Eye, FileText,
  FlaskConical, FlaskRound, Flame, Footprints, Gauge, HeartPulse, Inbox, Layers, Link, Microscope, Ruler, Scale,
  ScanHeart, ScanLine, Settings, ShieldCheck, Sun, Target, TestTube, Waves, Wind, Candy, Magnet, Radio, Circle,
  Scan, LayoutGrid, Fish,
} from "lucide-preact";

type Icon = ComponentType<{ size?: number | string; strokeWidth?: number | string; class?: string; "aria-hidden"?: boolean }>;

const PANEL: Record<string, Icon> = {
  blood: Droplet,
  "blood.lipids": Droplets,
  "blood.fatty_acids": Fish,
  "blood.glucose": Candy,
  "blood.liver": FlaskRound,
  "blood.kidney": Bean,
  "blood.bone": Bone,
  "blood.cbc": Microscope,
  "blood.iron": Atom,
  "blood.thyroid": Waves,
  "blood.hormones": Scale,
  "blood.vitamins": Sun,
  "blood.inflammation": Flame,
  "blood.tumour": Target,
  "blood.coag": Link,
  "blood.serology": ShieldCheck,
  urine: TestTube,
  "urine.chemistry": FlaskConical,
  "urine.dipstick": ClipboardList,
  "urine.microscopy": Microscope,
  stool: Layers,
  vitals: HeartPulse,
  "vitals.body": Ruler,
  "vitals.bp": Gauge,
  cardio: Activity,
  "cardio.ecg": Activity,
  "cardio.treadmill": Footprints,
  "cardio.echo": ScanHeart,
  "cardio.ct": ScanLine,
  "cardio.vascular": HeartPulse,
  imaging: ScanLine,
  "imaging.findings": ScanLine,
  "imaging.bone": Bone,
  screening: Eye,
  "screening.vision": Eye,
  "screening.hearing": Ear,
  "screening.lung": Wind,
  "screening.colon": Scan,
};

const PAGE: Record<string, Icon> = {
  overview: LayoutGrid,
  documents: FileText,
  explore: ChartLine,
  inbox: Inbox,
  usage: CircleDollarSign,
  settings: Settings,
  imaging: ScanLine,
};

const MODALITY: Record<string, Icon> = {
  ultrasound: Radio,
  "x-ray": ScanLine,
  xray: ScanLine,
  mammogram: Circle,
  echocardiogram: ScanHeart,
  ct: Scan,
  mri: Magnet,
};

/** icon for a panel id like "blood.lipids"; falls back to its group ("blood"), then a neutral flask */
export function PanelIcon({ id, size = 16 }: { id?: string | null; size?: number }) {
  const I = (id && (PANEL[id] ?? PANEL[id.split(".")[0]])) || FlaskConical;
  return <I size={size} strokeWidth={1.9} class="ico" aria-hidden />;
}

export function PageIcon({ name, size = 18 }: { name: keyof typeof PAGE; size?: number }) {
  const I = PAGE[name];
  return <I size={size} strokeWidth={1.9} class="ico" aria-hidden />;
}

export function ModalityIcon({ modality, size = 16 }: { modality: string; size?: number }) {
  const I = MODALITY[modality.toLowerCase()] ?? Scan;
  return <I size={size} strokeWidth={1.9} class="ico" aria-hidden />;
}

export { FileText as DocIcon };
