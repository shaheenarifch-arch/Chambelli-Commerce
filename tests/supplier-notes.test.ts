import { describe, expect, it } from "vitest";
import { cleanSupplierNotes } from "@chambelli/cj";

describe("cleanSupplierNotes", () => {
  const cases: Array<[string, string]> = [
    [
      "CIFbuy Mandala Wind Chime with Rotating Hook, Outdoor Garden Decor, Gift for Friends & Family(TikTok, temu pick-up service)",
      "CIFbuy Mandala Wind Chime with Rotating Hook, Outdoor Garden Decor, Gift for Friends & Family",
    ],
    ["Desk Organizer (TikTok, temu pick-up service)", "Desk Organizer"],
    [
      "CIFbuy Vintage Motorcycle Aluminum Round Sign, Holiday Gift （TikTok, TikTok, Self-pickup Logiopics）",
      "CIFbuy Vintage Motorcycle Aluminum Round Sign, Holiday Gift",
    ],
    ["Retro Sign （Inch ikTok, Inch ikTok, t Self-pickup Logiopics）", "Retro Sign"],
    ["Metal Sign （TikTok, Temu Self-pickup Logiaqics）", "Metal Sign"],
    ["Gate Sign （This Gate MetikTok, This ", "Gate Sign"],
    ["Mini Decor （FlaikTok, FlaikTok, Backdrop Mini Decor Self-uockup Log", "Mini Decor"],
    [
      "Black Heated Towel Rack, Plug-in/Hard-Wired[Unable ship on weekends, TK/TEMU only for pi",
      "Black Heated Towel Rack, Plug-in/Hard-Wired",
    ],
    ["Back Brace (US Logistics only For USPS.TK/TMEU only For self-pickup)", "Back Brace"],
    [
      "LED Headlamp (US Logistics For USPS/DHL/Fedex/UPS. No designated logistics accepted，TK/TMEU only For self-",
      "LED Headlamp",
    ],
    [
      "USB Flashlight (US Logistics For USPS/DHL/Fedex/UPS. No designated logistics acceptedTK/TMEU only For self-pickup",
      "USB Flashlight",
    ],
    ["Desk Lamp Black(Shipment from Walmart)", "Desk Lamp Black"],
    ["Solar heated shower (Amazon Shipping)", "Solar heated shower"],
    [
      "Bathroom Storage Cabinet-Grey ( Amazon Shipping)（Prohibited by WalMart）",
      "Bathroom Storage Cabinet-Grey",
    ],
    [
      "no provide self pick-up.8FT Pre-Lit Pencil Christmas Trees",
      "8FT Pre-Lit Pencil Christmas Trees",
    ],
    [
      "CIFbuy TikTok, temu pick-up service Acrylic Colorful Butterfly",
      "CIFbuy Acrylic Colorful Butterfly",
    ],
    ["Wall Sign PikTok, PikTok, Self-e ckup Logiopme", "Wall Sign"],
    ["Gift Box (Alternate code: 86358020)", "Gift Box"],
  ];
  it.each(cases)("strips the note from %s", (input, expected) => {
    expect(cleanSupplierNotes(input)).toBe(expected);
  });

  it("keeps real bracketed text and plain titles", () => {
    expect(cleanSupplierNotes("（2 Pack）USB Rechargeable LED Headlamp")).toBe(
      "（2 Pack）USB Rechargeable LED Headlamp",
    );
    expect(cleanSupplierNotes("Pickup Truck Bed Mat (Black, 6 ft)")).toBe(
      "Pickup Truck Bed Mat (Black, 6 ft)",
    );
    expect(cleanSupplierNotes("Dog Kennel")).toBe("Dog Kennel");
  });
});
