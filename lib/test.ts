import { db } from "@/lib/store";

export function testStore() {
  console.log("Testing store import:", db.listOffers().length);
}
