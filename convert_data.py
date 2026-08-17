import json
import pandas as pd

# 1. 读取 Kaggle 下载的 CSV 文件（请根据你的文件名修改）
df = pd.read_csv("players.csv")

# 2. 定义你要保留的目标联赛（Kaggle表格里通常用英文名称）
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

# 过滤出这些联赛的球员
df_filtered = df[df["league_name"].isin(target_leagues)].copy()


# 3. 简化位置映射（Kaggle里位置可能写得很复杂，如 "ST, CF" 或 "CB"）
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


df_filtered["simple_pos"] = df_filtered["player_positions"].apply(map_position)

teams_database = []

# 4. 按俱乐部进行分组打包
for club_name, group in df_filtered.groupby("club_name"):
  if pd.isna(club_name) or club_name.strip() == "":
    continue

  league_name = group["league_name"].iloc[0]
  players_list = []

  # 取俱乐部的前 22 名球员作为一线队大名单
  for _, row in group.head(22).iterrows():
    player_data = {
        "name": str(
            row.get("short_name", row.get("long_name", "未知球员"))
        ),  # 后面你可以写个字典把英文名映射成中文
        "position": row["simple_pos"],
        "age": int(row["age"]),
        "overall": int(row["overall"]),
        "potential": int(row["potential"]),
        "value": (
            float(row["value_eur"]) / 1000000
            if "value_eur" in row and pd.notna(row["value_eur"])
            else 10.0
        ),  # 转换为百万欧元
    }
    players_list.append(player_data)

  # 只有当球队人数足够时才录入
  if len(players_list) >= 15:
    team_id = club_name.lower().replace(" ", "_")
    teams_database.append({
        "id": team_id,
        "name": club_name,  # 导出后你可以在这里批量替换成中文队名
        "league": league_name,
        "budget": 50.0,  # 默认预算
        "players": players_list,
    })

# 5. 导出为 JSON 文件
with open("teams_output.json", "w", encoding="utf-8") as f:
  json.dump(teams_database, f, ensure_ascii=False, indent=2)

print(
    f"转换完成！成功生成 {len(teams_database)} 支球队的数据，已保存至"
    " teams_output.json"
)