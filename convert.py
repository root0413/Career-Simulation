import json
import os
import pandas as pd

target_file = "male_players.csv"

if not os.path.exists(target_file):
  print(f"❌ 错误：在当前目录下没有找到 {target_file}！")
  exit()

print(f"✅ 成功锁定目标文件：【{target_file}】，正在读取数据...")

df = None
for enc in ["utf-8", "utf-8-sig", "latin1", "cp1252"]:
  try:
    df = pd.read_csv(target_file, encoding=enc, low_memory=False)
    break
  except Exception:
    continue

if df is None:
  print("❌ 无法读取 CSV 文件。")
  exit()


# 智能查找列名函数
def find_col(possible_names):
  for name in possible_names:
    if name in df.columns:
      return name
  return None


col_league = find_col(["League", "league_name", "league", "competition_name"])
col_club = find_col(["Team", "club_name", "club", "team_name"])
col_name = find_col(["Name", "short_name", "long_name", "player_name"])
col_pos = find_col(["Position", "player_positions", "positions"])
col_age = find_col(["Age", "age"])
col_ovr = find_col(["OVR", "overall", "rating"])
col_pot = find_col(["Potential", "potential", "pot"])
col_val = find_col(["Value", "value_eur", "value", "market_value"])

print(
    f"🔍 匹配结果 -> 联赛: {col_league}, 俱乐部: {col_club}, 名字:"
    f" {col_name}, 总评: {col_ovr}"
)

if not col_league or not col_club or not col_ovr:
  print("❌ 关键列缺失，当前表格的所有列名为：")
  print(list(df.columns))
  exit()

target_leagues = [
    "Premier League",  # 英超
    "La Liga",  # 西甲
    "Serie A",  # 意甲
    "Bundesliga",  # 德甲
    "Ligue 1",  # 法甲
    "Primeira Liga",  # 葡超
    "Süper Lig",  # 土超
    "Eredivisie",  # 荷甲
]

# 模糊匹配目标联赛
df_filtered = df[
    df[col_league]
    .astype(str)
    .str.contains("|".join(target_leagues), case=False, na=False)
].copy()


def map_position(pos_str):
  if not isinstance(pos_str, str):
    return "MID"
  pos = pos_str.upper()
  if "GK" in pos:
    return "GK"
  elif any(p in pos for p in ["CB", "LB", "RB", "LWB", "RWB", "DEF"]):
    return "DEF"
  elif any(p in pos for p in ["ST", "CF", "LW", "RW", "FW"]):
    return "FWD"
  else:
    return "MID"


df_filtered["simple_pos"] = (
    df_filtered[col_pos].apply(map_position)
    if col_pos
    else "MID"
)

teams_database = []

for club_name, group in df_filtered.groupby(col_club):
  if pd.isna(club_name) or str(club_name).strip() == "":
    continue

  league_val = str(group[col_league].iloc[0])
  players_list = []

  for _, row in group.head(22).iterrows():
    p_name = str(row.get(col_name, "未知球员"))
    p_age = int(row.get(col_age, 22)) if col_age else 22
    p_ovr = int(row.get(col_ovr, 70))

    # 如果表格里没有潜力和身价，根据总评和年龄智能推导
    if col_pot and pd.notna(row.get(col_pot)):
      p_pot = int(row.get(col_pot))
    else:
      # 年轻球员潜力高，老将潜力贴近当前总评
      p_pot = (
          p_ovr + 6
          if p_age <= 21
          else (p_ovr + 3 if p_age <= 25 else p_ovr)
      )

    if col_val and pd.notna(row.get(col_val)):
      try:
        val_str = (
            str(row.get(col_val))
            .replace("€", "")
            .replace("M", "")
            .replace(",", "")
        )
        p_val = float(val_str)
      except:
        p_val = max(1.0, (p_ovr - 60) * 1.5)
    else:
      # 根据总评估算身价 (单位：百万欧元)
      p_val = max(1.0, round((p_ovr - 65) * 1.5, 1)) if p_ovr > 65 else 2.0

    player_data = {
        "name": p_name,
        "position": (
            row["simple_pos"] if "simple_pos" in row else "MID"
        ),
        "age": p_age,
        "overall": p_ovr,
        "potential": p_pot,
        "value": p_val,
    }
    players_list.append(player_data)

  if len(players_list) >= 15:
    team_id = str(club_name).lower().replace(" ", "_")
    teams_database.append({
        "id": team_id,
        "name": str(club_name),
        "league": league_val,
        "budget": 50.0,
        "players": players_list,
    })

with open("teams_output.json", "w", encoding="utf-8") as f:
  json.dump(teams_database, f, ensure_ascii=False, indent=2)

print(
    f"🎉 转换完成！成功生成 {len(teams_database)} 支球队的数据，已保存至"
    " teams_output.json"
)