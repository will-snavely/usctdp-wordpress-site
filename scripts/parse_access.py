from datetime import datetime
import csv
import json

def parse_families(path):
    families = {}
    with open(path) as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            id = row[0]
            if id in families:
                print("collision! " + id)
                continue
            
            family = {
                "id": id,
                "last": row[1],
                "addr_street": row[2],
                "addr_city": row[3],
                "addr_state": row[4],
                "addr_zip": row[5],
                "phone": row[6].split("/"),
                "email1": row[-2],
                "email2": row[-1],
            }
            
            children = []
            for child_idx in range(4):
                offset = 7 + child_idx*3
                name = row[offset].strip()
                if not name:
                    continue
                children.append({
                    "name": name,
                    "age_group": row[offset+1].strip(),
                    "birthday": row[offset+2].strip()
                })
            family["children"] = children
            families[id] = family
    return families

def dedupe_families(families):
    """Merge family entries that share the same email1, combining children
    without duplicates. Returns (merged_families, canonical_id_map) where
    canonical_id_map maps every original family id to the id it was merged into."""
    by_email = {}
    for fam_id, fam in families.items():
        email = fam["email1"].strip().lower()
        if not email:
            continue
        by_email.setdefault(email, []).append(fam_id)

    canonical = {}
    merged = {}
    for email, ids in by_email.items():
        ids = sorted(ids)
        primary_id = ids[0]
        primary = families[primary_id]

        seen_children = set()
        combined_children = []
        for fam_id in ids:
            for child in families[fam_id]["children"]:
                key = (child["name"].strip().lower(), child["birthday"])
                if key in seen_children:
                    continue
                seen_children.add(key)
                combined_children.append(child)
        primary["children"] = combined_children

        for fam_id in ids:
            canonical[fam_id] = primary_id
        merged[primary_id] = primary

    for fam_id, fam in families.items():
        if fam_id not in canonical:
            canonical[fam_id] = fam_id
            merged[fam_id] = fam

    return merged, canonical

def export_registrations(path):
    regs={}
    with open(path) as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            fam_id = row[1]
            if fam_id not in regs:
                regs[fam_id] = []
            

            regs[fam_id].append({
                "name": row[2],
                "age": row[3],
                "txn_date": row[4],
                "session": row[5],
                "level": row[6],
                "description": row[7],
                "day1": row[8],
                "day2": row[9],
                "debit": row[11],
                "credit": row[12],
                "bill": row[13],
                "how_much": row[14],
                "check_num": row[19],
                "check_recv_date": row[20],
                "capture_date": row[21],
                "batch_num": row[22]
            })
    return regs

def parse_date(d):
    try:
        return datetime.strptime(d, "%m/%d/%y %H:%M:%S")
    except:
        return None

if __name__ == "__main__":
    import sys
    families_file = sys.argv[1]
    reg_file = sys.argv[2]
    families = parse_families(families_file)
    families, canonical = dedupe_families(families)
    regs = export_registrations(reg_file)

    combined_regs = {}
    for family_id, family_regs in regs.items():
        canonical_id = canonical.get(family_id, family_id)
        combined_regs.setdefault(canonical_id, []).extend(family_regs)

    cutoff = datetime(2020, 1, 1, 0, 0 ,0)
    output = []
    for family_id in combined_regs:
        dates = [parse_date(reg["txn_date"]) for reg in combined_regs[family_id]]
        dates = [d for d in dates if d]
        if dates:
            earliest = min(dates)
            latest = max(dates)
            if latest > cutoff:
                if family_id in families:
                    family = families[family_id]
                    family["regs"] = combined_regs[family_id]
                    output.append(families[family_id])

    print(len(output), file=sys.stderr)
    print(json.dumps(output, indent=4))
