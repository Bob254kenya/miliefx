import { Heart, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const favorites = [
  { id: 1, name: "Volatility 100 Index", type: "Over/Under" },
  { id: 2, name: "Volatility 75 Index", type: "Even/Odd" },
  { id: 3, name: "Jump 50 Index", type: "Matches/Differs" },
];

export default function FavoritesPage() {
  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-background to-muted">
      
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Heart className="text-red-500" />
        <h1 className="text-2xl font-bold">Favorites</h1>
      </div>

      {/* Empty State */}
      {favorites.length === 0 && (
        <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
          <Heart size={40} />
          <p className="mt-2">No favorites added yet</p>
        </div>
      )}

      {/* Favorites Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {favorites.map((item) => (
          <motion.div
            key={item.id}
            whileHover={{ scale: 1.05 }}
            className="relative"
          >
            <Card className="backdrop-blur-xl bg-white/5 dark:bg-white/10 border border-white/10 shadow-xl rounded-2xl overflow-hidden">
              
              {/* Glow Effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 opacity-0 hover:opacity-100 transition" />

              <CardContent className="p-5 relative z-10">
                
                {/* Title */}
                <h2 className="text-lg font-semibold mb-1">
                  {item.name}
                </h2>

                {/* Type */}
                <p className="text-sm text-muted-foreground mb-4">
                  Strategy: {item.type}
                </p>

                {/* Actions */}
                <div className="flex justify-between items-center">
                  
                  <Button size="sm" className="rounded-xl">
                    Open
                  </Button>

                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 size={16} />
                  </Button>

                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
